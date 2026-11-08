' All HTTP, timers, and registry operations run off the render thread.
sub init()
    m.top.functionName = "networkLoop"
end sub

sub networkLoop()
    m.port = CreateObject("roMessagePort")
    m.top.ObserveField("request", m.port)
    m.registry = CreateObject("roRegistrySection", "AOATV")
    m.base = m.registry.Read("base")
    m.token = m.registry.Read("token")
    m.pending = {}
    m.ackRetries = []
    m.clock = CreateObject("roTimespan")
    m.clock.Mark()
    m.lastPoll = -2000
    m.lastStatus = -10000
    m.lastProgress = -15000
    m.top.response = {tag: "bootstrap", base: m.base, configured: m.base <> "" and m.token <> ""}
    while true
        event = wait(100, m.port)
        if type(event) = "roSGNodeEvent"
            request = event.GetData()
            if request <> invalid
                if request.tag = "configure"
                    configure(request)
                else
                    startRequest(request)
                end if
            end if
        else if type(event) = "roUrlEvent"
            finishRequest(event)
        end if
        tick()
    end while
end sub

sub configure(request as object)
    for each key in m.pending
        m.pending[key].transfer.AsyncCancel()
    end for
    m.pending = {}
    m.ackRetries = []
    m.base = request.base
    if request.preserveToken <> true then m.token = request.token
    m.registry.Write("base", m.base)
    m.registry.Write("token", m.token)
    m.registry.Flush()
    m.lastPoll = -2000
    m.lastStatus = -10000
    m.top.response = {tag: "configured", configured: m.base <> "" and m.token <> ""}
end sub

sub startRequest(request as object)
    if m.base = "" or m.token = "" then return
    transfer = CreateObject("roUrlTransfer")
    transfer.SetMessagePort(m.port)
    transfer.SetCertificatesFile("common:/certs/ca-bundle.crt")
    transfer.InitClientCertificates()
    transfer.SetUrl(m.base + "/api/v1" + request.path)
    transfer.AddHeader("Authorization", "Bearer " + m.token)
    transfer.RetainBodyOnError(true)
    method = "GET"
    if request.method <> invalid then method = request.method
    transfer.SetRequest(method)
    started = false
    if method = "GET" or method = "DELETE"
        started = transfer.AsyncGetToString()
    else
        transfer.AddHeader("Content-Type", "application/json")
        body = {}
        if request.body <> invalid then body = request.body
        started = transfer.AsyncPostFromString(FormatJson(body))
    end if
    if started
        key = transfer.GetIdentity().ToStr()
        m.pending[key] = {transfer: transfer, request: request, started: m.clock.TotalMilliseconds()}
    else
        retryAcknowledgement(request)
        m.top.response = {tag: request.tag, ok: false, code: 0, error: "Cannot connect to backend.", context: request}
    end if
end sub

sub finishRequest(event as object)
    key = event.GetSourceIdentity().ToStr()
    pending = m.pending[key]
    if pending = invalid then return
    m.pending.Delete(key)
    code = event.GetResponseCode()
    data = ParseJson(event.GetString())
    response = {tag: pending.request.tag, ok: code >= 200 and code < 300, code: code, data: data, context: pending.request}
    if not response.ok
        if pending.request.tag = "heartbeat" then print "AOA heartbeat failed, HTTP "; code
        if code <= 0 or code = 408 or code = 429 or code >= 500 then retryAcknowledgement(pending.request)
        response.error = "Backend unavailable. Check the URL, connection, and device token."
        if code = 401 or code = 403 then response.error = "Device token rejected or revoked. Update it in Settings."
        if data <> invalid and data.error <> invalid then response.error = data.error
    else if data = invalid
        response.ok = false
        response.error = "Backend returned invalid JSON."
    end if
    m.top.response = response
end sub

sub retryAcknowledgement(request as object)
    if request.tag <> "ack" then return
    attempts = 0
    if request.attempts <> invalid then attempts = request.attempts
    attempts++
    if attempts > 5 then attempts = 5
    request.attempts = attempts
    delay = 1000 * (2 ^ attempts)
    if delay > 30000 then delay = 30000
    m.ackRetries.Push({request: request, due: m.clock.TotalMilliseconds() + delay})
end sub

function hasPending(tag as string) as boolean
    for each key in m.pending
        if m.pending[key].request.tag = tag then return true
    end for
    return false
end function

sub tick()
    now = m.clock.TotalMilliseconds()
    expired = []
    for each key in m.pending
        timeout = 15000
        if m.pending[key].request.tag = "resolve" or m.pending[key].request.tag = "catalog" then timeout = 70000
        if now - m.pending[key].started > timeout then expired.Push(key)
    end for
    for each key in expired
        pending = m.pending[key]
        pending.transfer.AsyncCancel()
        m.pending.Delete(key)
        retryAcknowledgement(pending.request)
        m.top.response = {tag: pending.request.tag, ok: false, code: 0, error: "Backend timed out. Check your connection.", context: pending.request}
    end for
    if m.base = "" or m.token = "" then return
    retries = m.ackRetries
    m.ackRetries = []
    for each retry in retries
        if retry.due <= now
            startRequest(retry.request)
        else
            m.ackRetries.Push(retry)
        end if
    end for
    if now - m.lastPoll >= 2000 and not hasPending("poll")
        m.lastPoll = now
        startRequest({tag: "poll", path: "/roku/commands"})
    end if
    snapshot = m.top.snapshot
    if snapshot = invalid then return
    if now - m.lastStatus >= 10000 and not hasPending("heartbeat")
        m.lastStatus = now
        startRequest({tag: "heartbeat", path: "/roku/status", method: "POST", body: snapshot.status})
    end if
    if now - m.lastProgress >= 15000 and snapshot.progress <> invalid and not hasPending("progress")
        m.lastProgress = now
        startRequest({tag: "progress", path: "/roku/progress", method: "PUT", body: snapshot.progress})
    end if
end sub
