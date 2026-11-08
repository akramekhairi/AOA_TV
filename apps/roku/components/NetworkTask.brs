' All HTTP, timers, and registry operations run off the render thread.
sub init()
    m.top.functionName = "networkLoop"
end sub

sub networkLoop()
    m.port = CreateObject("roMessagePort")
    m.top.ObserveField("request", m.port)
    m.registry = CreateObject("roRegistrySection", "AOATV")
    m.base = m.registry.Read("base")
    ' Migrate only the recognized hosted origin once; preserve custom setup and
    ' allow an administrator to restore the old origin after this migration.
    if m.base = "https://aoa-tv-api.onrender.com" and m.registry.Read("azureMigration202611") <> "1"
        m.base = "https://aoa-tv-akramekhairi.northcentralus.cloudapp.azure.com"
        m.registry.Write("base", m.base)
        m.registry.Write("azureMigration202611", "1")
        m.registry.Flush()
    end if
    m.token = m.registry.Read("token")
    ' One ephemeral ID per app run, never persisted or derived from a device ID.
    deviceInfo = CreateObject("roDeviceInfo")
    m.connectionId = deviceInfo.GetRandomUUID()
    m.pending = {}
    m.ackRetries = []
    m.pairingAckStates = {}
    m.progressLatest = invalid
    m.progressVersion = 0
    m.progressDue = 0
    m.progressAttempts = 0
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
    m.pairingAckStates = {}
    m.progressLatest = invalid
    m.progressVersion++
    m.progressAttempts = 0
    m.base = request.base
    if request.preserveToken <> true then m.token = request.token
    m.registry.Write("base", m.base)
    m.registry.Write("token", m.token)
    m.registry.Flush()
    m.lastPoll = -2000
    m.lastStatus = -10000
    m.lastProgress = -15000
    m.top.response = {tag: "configured", configured: m.base <> "" and m.token <> ""}
end sub

sub startRequest(request as object)
    if m.base = "" or m.token = "" then return
    if request.tag = "pairingAck"
        requestId = request.body.requestId
        if request.attempts = invalid
            request.attempts = 0
            request.retryDeadline = m.clock.TotalMilliseconds() + 10000
            m.pairingAckStates[requestId] = request.body.status
        end if
        ' A queued shown acknowledgement must never follow a dismissal.
        if m.pairingAckStates[requestId] <> request.body.status then return
        if m.clock.TotalMilliseconds() >= request.retryDeadline then return
    end if
    if request.tag = "progress" and request.progressVersion = invalid
        queueProgress(request.body)
        return
    end if
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
        finishProgress(request, false, true)
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
        if pending.request.tag = "pairingAck" then retryAcknowledgement(pending.request)
    end if
    retryable = code <= 0 or code = 408 or code = 429 or code >= 500 or (code >= 200 and code < 300 and data = invalid)
    finishProgress(pending.request, response.ok, retryable)
    m.top.response = response
end sub

' Keep only the newest sample and serialize writes so retries cannot rewind progress.
sub queueProgress(body as object)
    m.progressVersion++
    m.progressLatest = body
    m.progressAttempts = 0
    m.progressDue = m.clock.TotalMilliseconds()
end sub

sub finishProgress(request as object, success as boolean, retryable as boolean)
    if request.tag <> "progress" then return
    if request.progressVersion <> m.progressVersion then return
    if success
        m.progressLatest = invalid
        m.progressAttempts = 0
        print "AOA stage progress_saved"
    else if retryable and m.progressAttempts < 5
        m.progressAttempts++
        delay = 1000 * (2 ^ m.progressAttempts)
        if delay > 30000 then delay = 30000
        m.progressDue = m.clock.TotalMilliseconds() + delay
        print "AOA stage progress_retry"
    else
        m.progressLatest = invalid
        print "AOA stage progress_failed"
    end if
end sub

sub retryAcknowledgement(request as object)
    if request.tag = "pairingAck"
        if request.attempts >= 2 then return
        if m.pairingAckStates[request.body.requestId] <> request.body.status then return
        request.attempts++
        due = m.clock.TotalMilliseconds() + 1000 * request.attempts
        if due < request.retryDeadline then m.ackRetries.Push({request: request, due: due})
        return
    end if
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
        if m.pending[key].request.tag = "pairingAck" then timeout = 3000
        if m.pending[key].request.tag = "resolve" or m.pending[key].request.tag = "catalog" then timeout = 70000
        if m.pending[key].request.tag = "detail" or m.pending[key].request.tag = "episodes" or m.pending[key].request.tag = "issued" or m.pending[key].request.tag = "progress" then timeout = 45000
        if now - m.pending[key].started > timeout then expired.Push(key)
    end for
    for each key in expired
        pending = m.pending[key]
        pending.transfer.AsyncCancel()
        m.pending.Delete(key)
        retryAcknowledgement(pending.request)
        finishProgress(pending.request, false, true)
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
        startRequest({tag: "poll", path: "/roku/commands?connectionId=" + m.connectionId})
    end if
    snapshot = m.top.snapshot
    if snapshot = invalid then return
    if m.progressLatest <> invalid
        if snapshot.status.sessionId <> m.progressLatest.sessionId
            m.progressLatest = invalid
            m.progressVersion++
        end if
    end if
    if now - m.lastStatus >= 10000 and not hasPending("heartbeat")
        m.lastStatus = now
        startRequest({tag: "heartbeat", path: "/roku/status", method: "POST", body: snapshot.status})
    end if
    if now - m.lastProgress >= 15000 and snapshot.progress <> invalid and not hasPending("progress")
        m.lastProgress = now
        queueProgress(snapshot.progress)
    end if
    if m.progressLatest <> invalid and now >= m.progressDue and not hasPending("progress")
        startRequest({tag: "progress", path: "/roku/progress", method: "PUT", body: m.progressLatest, progressVersion: m.progressVersion})
    end if
end sub
