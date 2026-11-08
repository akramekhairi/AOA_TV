sub init()
    m.top.backgroundColor = "0x0B1220FF"
    m.menu = m.top.FindNode("menu")
    m.list = m.top.FindNode("list")
    m.heading = m.top.FindNode("heading")
    m.connection = m.top.FindNode("connection")
    m.description = m.top.FindNode("description")
    m.detailTitle = m.top.FindNode("detailTitle")
    m.descriptionImage = m.top.FindNode("descriptionImage")
    m.hint = m.top.FindNode("hint")
    m.video = m.top.FindNode("video")
    m.net = m.top.FindNode("network")
    m.details = m.top.FindNode("details")
    m.detailButtons = m.top.FindNode("detailButtons")
    m.watchdog = m.top.FindNode("playbackWatchdog")
    m.base = ""
    m.token = ""
    m.configured = false
    m.rows = []
    m.favorites = {}
    m.commands = []
    m.seen = {}
    m.seenOrder = []
    m.commandBusy = false
    m.activeCommand = invalid
    m.resolvingCommand = invalid
    m.targetSession = ""
    m.selectionSerial = 0
    m.issuingPlay = false
    m.awaitingPlay = invalid
    m.playback = invalid
    m.lastSession = ""
    m.lastContent = ""
    m.playState = "idle"
    m.viewSerial = 0
    m.nav = 0
    m.page = 1
    m.mediaType = ""
    m.category = ""
    m.query = ""
    m.mode = "settings"
    m.episodes = []
    m.reloadPaused = false
    m.selectedSubtitleTrack = ""
    m.selectSubtitleWhenAvailable = false
    m.currentPosition = 0
    m.currentDuration = 0
    root = CreateObject("roSGNode", "ContentNode")
    for each title in ["Continue Watching", "Favorites", "Live", "Movies", "Series", "Search", "Settings"]
        node = root.CreateChild("ContentNode")
        node.title = title
    end for
    m.menu.content = root
    m.menu.ObserveField("itemSelected", "menuSelected")
    m.list.ObserveField("itemSelected", "itemSelected")
    m.list.ObserveField("itemFocused", "itemFocused")
    m.detailButtons.ObserveField("itemSelected", "detailSelected")
    m.video.ObserveField("state", "videoStateChanged")
    m.video.ObserveField("position", "videoPositionChanged")
    m.video.ObserveField("availableSubtitleTracks", "subtitleTracksChanged")
    m.video.ObserveField("currentSubtitleTrack", "subtitleTrackChanged")
    m.watchdog.ObserveField("fire", "playbackTimedOut")
    m.net.ObserveField("response", "networkResponse")
    updateSnapshot(false)
    m.net.control = "RUN"
    m.menu.SetFocus(true)
end sub

function textValue(value as dynamic) as string
    if value = invalid then return ""
    return value.ToStr()
end function

function uri(value as string) as string
    result = ""
    digits = "0123456789ABCDEF"
    bytes = CreateObject("roByteArray")
    bytes.FromAsciiString(value)
    for each byte in bytes
        if (byte >= 48 and byte <= 57) or (byte >= 65 and byte <= 90) or (byte >= 97 and byte <= 122) or byte = 45 or byte = 46 or byte = 95 or byte = 126
            result += Chr(byte)
        else
            ' Numeric ToStr takes a format string on Roku, not a numeric radix.
            high = Int(byte / 16)
            low = byte mod 16
            result += "%" + Mid(digits, high + 1, 1) + Mid(digits, low + 1, 1)
        end if
    end for
    return result
end function

sub request(tag as string, path as string, method = "GET" as string, body = invalid as dynamic, extra = invalid as dynamic)
    req = {tag: tag, path: path, method: method, view: m.viewSerial}
    if body <> invalid then req.body = body
    if extra <> invalid then req.extra = extra
    m.net.request = req
end sub

sub menuSelected()
    m.selectionSerial++
    m.issuingPlay = false
    m.details.visible = false
    m.nav = m.menu.itemSelected
    m.viewSerial++
    m.page = 1
    m.category = ""
    m.query = ""
    m.mediaType = ""
    if m.nav = 6
        settings()
        return
    end if
    if not m.configured
        settings()
        showMessage("Setup required", "Enter the backend URL and the Roku device token issued by your administrator in Settings.")
        return
    end if
    m.heading.text = m.menu.content.GetChild(m.nav).title
    showRows([{title: "Loading...", kind: "noop"}], "loading")
    if m.nav = 0
        request("continue", "/progress")
    else if m.nav = 1
        request("favorites", "/favorites")
    else if m.nav >= 2 and m.nav <= 4
        types = ["live", "movie", "series"]
        m.mediaType = types[m.nav - 2]
        request("categories", "/categories?type=" + m.mediaType)
    else if m.nav = 5
        keyboard("search", "Search titles", "", false)
    end if
    m.list.SetFocus(true)
end sub

sub showRows(rows as object, mode as string)
    m.rows = rows
    m.mode = mode
    root = CreateObject("roSGNode", "ContentNode")
    if rows.Count() = 0
        rows.Push({title: "No results. Press Left for the menu.", kind: "noop"})
    end if
    for each row in rows
        node = root.CreateChild("ContentNode")
        node.title = textValue(row.title)
        node.AddFields({titleImage: textValue(row.titleImage)})
    end for
    m.list.content = root
    m.list.jumpToItem = 0
    itemFocused()
end sub

sub loadCatalog()
    m.viewSerial++
    path = "/catalog?page=" + m.page.ToStr() + "&pageSize=30"
    if m.mediaType <> "" then path += "&type=" + m.mediaType
    if m.category <> "" then path += "&categoryId=" + uri(m.category)
    if m.query <> "" then path += "&q=" + uri(m.query)
    showRows([{title: "Loading...", kind: "noop"}], "loading")
    request("catalog", path)
end sub

sub settings()
    m.details.visible = false
    m.heading.text = "Settings"
    rows = [
        {title: "Backend URL: " + m.base, kind: "base"}
        {title: "Enter Roku device token", kind: "token"}
        {title: "Create phone pairing code", kind: "pair"}
        {title: "Manage paired phones", kind: "devices"}
        {title: "Refresh provider catalog", kind: "refresh"}
        {title: "Forget backend and token", kind: "forget"}
    ]
    showRows(rows, "settings")
    m.description.text = "Use a reachable backend origin, for example http://192.168.1.10:3000. The token comes from admin enrollment. Never enter an admin key."
    m.list.SetFocus(true)
end sub

sub itemFocused()
    index = m.list.itemFocused
    if index < 0 or index >= m.rows.Count() then return
    row = m.rows[index]
    m.detailTitle.uri = textValue(row.titleImage)
    m.descriptionImage.uri = textValue(row.descriptionImage)
    m.descriptionImage.visible = m.descriptionImage.uri <> ""
    m.description.visible = not m.descriptionImage.visible
    m.description.text = textValue(row.description)
    if row.season <> invalid and row.episode <> invalid
        m.description.text = "Season " + textValue(row.season) + " / Episode " + textValue(row.episode) + "  " + m.description.text
    end if
end sub

sub itemSelected()
    index = m.list.itemSelected
    if index < 0 or index >= m.rows.Count() then return
    row = m.rows[index]
    if row.kind = "noop" then return
    if row.kind = "base"
        keyboard("base", "Backend origin URL", m.base, false)
    else if row.kind = "token"
        keyboard("token", "Admin-issued Roku device token", "", true)
    else if row.kind = "pair"
        request("pair", "/pairing/code", "POST", {})
    else if row.kind = "devices"
        request("devices", "/devices")
    else if row.kind = "refresh"
        request("refresh", "/catalog/refresh", "POST", {})
    else if row.kind = "forget"
        m.dialogAction = "forget"
        dialog("Forget this device setup?", "You will need the backend URL and a Roku token to reconnect.", ["Forget", "Cancel"])
    else if row.kind = "device"
        m.selected = row
        m.dialogAction = "revoke"
        dialog("Revoke phone?", "This phone will lose access immediately.", ["Revoke phone", "Cancel"])
    else if row.kind = "category"
        m.category = row.id
        m.page = 1
        loadCatalog()
    else if row.kind = "next"
        m.page++
        loadCatalog()
    else if row.kind = "previous"
        m.page--
        loadCatalog()
    else if row.kind = "season"
        showSeason(row.season)
    else if row.id <> invalid
        m.selectionSerial++
        showDetails(row)
        print "AOA stage details_cached"
        request("detail", "/content/" + uri(row.id), "GET", invalid, {selection: m.selectionSerial, id: row.id})
    end if
end sub

sub keyboard(action as string, title as string, initial as string, secure as boolean)
    m.keyboardAction = action
    node = CreateObject("roSGNode", "StandardKeyboardDialog")
    node.title = title
    node.text = initial
    node.buttons = ["Save", "Cancel"]
    node.keyboardDomain = "generic"
    if secure
        node.keyboardDomain = "password"
        node.textEditBox.secureMode = true
    end if
    node.ObserveField("buttonSelected", "keyboardSelected")
    m.top.dialog = node
end sub

sub keyboardSelected()
    node = m.top.dialog
    if node = invalid then return
    selected = node.buttonSelected
    value = node.text.Trim()
    node.close = true
    if selected <> 0 then return
    if m.keyboardAction = "search"
        m.query = value
        m.heading.text = "Search"
        loadCatalog()
    else if m.keyboardAction = "base"
        while Right(value, 1) = "/"
            value = Left(value, Len(value) - 1)
        end while
        if (Left(value, 7) <> "http://" and Left(value, 8) <> "https://") or Instr(1, value, "@") > 0 or Instr(1, value, "?") > 0
            showMessage("Invalid backend URL", "Enter an http:// or https:// origin without a path, credentials, or query.")
            return
        end if
        authority = Mid(value, Instr(1, value, "://") + 3)
        if authority = "" or Instr(1, authority, "/") > 0 or Instr(1, authority, "#") > 0 or Instr(1, authority, " ") > 0
            showMessage("Invalid backend URL", "Enter only the backend origin, for example http://192.168.1.10:3000.")
            return
        end if
        m.base = value
        configure()
    else if m.keyboardAction = "token"
        m.token = value
        configure()
    end if
end sub

sub configure()
    if m.playback <> invalid then stopPlayback()
    m.net.request = {tag: "configure", base: m.base, token: m.token, preserveToken: m.token = "__stored__"}
    m.configured = m.base <> "" and m.token <> ""
    m.seen = {}
    m.seenOrder = []
    m.commands = []
    m.commandBusy = false
    m.activeCommand = invalid
    m.resolvingCommand = invalid
    m.targetSession = ""
    m.selectionSerial++
    m.issuingPlay = false
    m.awaitingPlay = invalid
    m.watchdog.control = "stop"
    m.viewSerial++
    settings()
end sub

sub dialog(title as string, message as string, buttons as object)
    node = CreateObject("roSGNode", "StandardMessageDialog")
    node.title = title
    node.message = [message]
    node.buttons = buttons
    node.ObserveField("buttonSelected", "dialogSelected")
    m.top.dialog = node
end sub

sub showMessage(title as string, message as string)
    m.dialogAction = "message"
    dialog(title, message, ["OK"])
end sub

sub showDetails(item as object, focus = true as boolean)
    m.selected = item
    m.detailTitle.uri = textValue(item.titleImage)
    m.descriptionImage.uri = textValue(item.descriptionImage)
    m.descriptionImage.visible = m.descriptionImage.uri <> ""
    m.description.visible = not m.descriptionImage.visible
    m.description.text = textValue(item.description)
    m.top.FindNode("fullTitle").uri = textValue(item.titleImage)
    m.top.FindNode("fullTitleText").text = textValue(item.title)
    m.top.FindNode("fullTitleText").visible = textValue(item.titleImage) = ""
    m.top.FindNode("fullDescription").uri = textValue(item.descriptionImage)
    m.top.FindNode("fullDescriptionText").text = textValue(item.description)
    m.top.FindNode("fullDescriptionText").visible = textValue(item.descriptionImage) = ""
    labels = []
    if item.type = "series"
        m.detailActions = ["episodes", "favorite"]
        labels = ["Seasons and episodes", "Toggle favorite"]
    else if item.type = "live"
        m.detailActions = ["play", "favorite"]
        labels = ["Play live", "Toggle favorite"]
    else
        m.detailActions = ["play", "restart", "favorite"]
        labels = ["Play / Resume", "Start over", "Toggle favorite"]
    end if
    root = CreateObject("roSGNode", "ContentNode")
    for each title in labels
        node = root.CreateChild("ContentNode")
        node.title = title
    end for
    selectedIndex = m.detailButtons.itemFocused
    m.detailButtons.content = root
    if not focus and selectedIndex >= 0 and selectedIndex < labels.Count() then m.detailButtons.jumpToItem = selectedIndex
    m.details.visible = true
    if focus then m.detailButtons.SetFocus(true)
end sub

sub detailSelected()
    action = m.detailActions[m.detailButtons.itemSelected]
    if action = "episodes"
        m.selectionSerial++
        m.details.visible = false
        m.list.SetFocus(true)
        request("episodes", "/series/" + uri(m.selected.id) + "/episodes", "GET", invalid, {selection: m.selectionSerial})
    else if action = "favorite"
        toggleFavorite(m.selected)
    else if action = "play" or action = "restart"
        if m.issuingPlay then return
        m.issuingPlay = true
        body = {action: "play", "contentId": m.selected.id}
        if action = "restart" then body.position = 0
        m.connection.text = "Requesting playback..."
        print "AOA stage native_play_requested"
        request("issued", "/commands", "POST", body, {selection: m.selectionSerial})
    end if
end sub

sub dialogSelected()
    node = m.top.dialog
    if node = invalid then return
    selected = node.buttonSelected
    node.close = true
    if m.dialogAction = "forget" and selected = 0
        m.base = ""
        m.token = ""
        configure()
    else if m.dialogAction = "revoke" and selected = 0
        request("revoke", "/devices/" + uri(m.selected.id), "DELETE")
    end if
end sub

sub toggleFavorite(item as object)
    if item.id = invalid then return
    method = "PUT"
    if m.favorites.DoesExist(item.id) then method = "DELETE"
    request("favoriteToggle", "/favorites/" + uri(item.id), method, {}, {id: item.id, enabled: method = "PUT"})
end sub

sub showSeasons()
    rows = []
    seen = {}
    for each item in m.episodes
        season = 1
        if item.season <> invalid then season = item.season
        if not seen.DoesExist(season.ToStr())
            seen[season.ToStr()] = true
            rows.Push({title: "Season " + season.ToStr(), kind: "season", season: season})
        end if
    end for
    showRows(rows, "seasons")
    m.heading.text = "Seasons"
    m.list.SetFocus(true)
end sub

sub showSeason(season as integer)
    rows = []
    for each item in m.episodes
        itemSeason = 1
        if item.season <> invalid then itemSeason = item.season
        if itemSeason = season then rows.Push(item)
    end for
    showRows(rows, "episodes")
    m.heading.text = "Season " + season.ToStr() + " / Episodes"
end sub

sub networkResponse()
    response = m.net.response
    tag = response.tag
    if tag = "bootstrap"
        m.base = response.base
        m.configured = response.configured
        ' Persisted token remains exclusively in the task until user changes setup.
        if m.configured
            m.token = "__stored__"
            m.connection.text = "Connecting to backend..."
            request("favoriteCache", "/favorites")
            request("restore", "/tv/status")
            m.menu.jumpToItem = 0
            m.nav = 0
            m.heading.text = "Continue Watching"
            request("continue", "/progress")
        else
            settings()
        end if
        return
    else if tag = "configured"
        m.connection.text = "Setup saved."
        if response.configured then request("favoriteCache", "/favorites")
        return
    end if
    if tag = "poll"
        if response.ok
            m.connection.text = "Connected  |  Phone remote ready"
            if response.data.commands <> invalid
                newestSession = ""
                for each command in response.data.commands
                    if not m.seen.DoesExist(command.id)
                        if command.action = "play" then newestSession = command.sessionId
                        m.seen[command.id] = true
                        m.seenOrder.Push(command.id)
                        m.commands.Push(command)
                    end if
                end for
                while m.seenOrder.Count() > 200
                    old = m.seenOrder.Shift()
                    m.seen.Delete(old)
                end while
                if newestSession <> ""
                    currentQueue = []
                    for each queued in m.commands
                        if queued.sessionId = newestSession then currentQueue.Push(queued)
                    end for
                    m.commands = currentQueue
                    m.targetSession = newestSession
                    if m.activeCommand <> invalid
                        if m.activeCommand.sessionId <> newestSession then stopPlayback()
                    end if
                end if
            end if
            nextCommand()
        else
            m.connection.text = response.error
        end if
        return
    end if
    if tag = "heartbeat" or tag = "progress" or tag = "ack"
        if not response.ok then m.connection.text = response.error
        if tag = "progress" and response.ok and m.playback = invalid then refreshContinue()
        return
    end if
    if tag = "resolve"
        resolveCommand(response)
        return
    end if
    if tag = "detail"
        extra = response.context.extra
        if extra.selection <> m.selectionSerial or not m.details.visible then return
        if m.selected.id <> extra.id then return
        if response.ok
            showDetails(response.data, false)
            print "AOA stage details_enriched"
        else
            m.connection.text = "Details unavailable. You can still play or retry this title."
            print "AOA stage details_unavailable"
        end if
        return
    end if
    if tag = "issued"
        print "AOA stage native_play_response HTTP "; response.code
        m.issuingPlay = false
        if response.context.extra.selection <> m.selectionSerial
            if response.ok and not m.seen.DoesExist(response.data.id)
                m.seen[response.data.id] = true
                m.seenOrder.Push(response.data.id)
                request("ack", "/roku/commands/" + uri(response.data.id) + "/ack", "POST", {status: "failed", error: "Playback cancelled before startup."})
            end if
            return
        end if
    end if
    if tag = "episodes"
        if response.context.extra.selection <> m.selectionSerial or response.context.view <> m.viewSerial then return
    end if
    if not response.ok
        showMessage("Request failed", response.error)
        return
    end if
    data = response.data
    if tag = "restore"
        if m.playback = invalid and m.lastSession = ""
            m.lastSession = textValue(data.sessionId)
            m.lastContent = textValue(data.contentId)
            updateSnapshot(true)
        end if
    else if tag = "favoriteCache" or tag = "favorites"
        m.favorites = {}
        for each item in data.items
            m.favorites[item.id] = true
        end for
        if tag = "favorites" and response.context.view = m.viewSerial then showRows(data.items, "favorites")
    else if tag = "favoriteToggle"
        extra = response.context.extra
        if extra.enabled
            m.favorites[extra.id] = true
            m.connection.text = "Added to favorites"
        else
            m.favorites.Delete(extra.id)
            m.connection.text = "Removed from favorites"
        end if
        if m.nav = 1 then request("favorites", "/favorites")
    else if tag = "pair"
        showMessage("Phone pairing code: " + data.code, "Enter this code in the phone app. Expires: " + data.expiresAt + ". Anyone with this code can pair a phone.")
    else if tag = "devices"
        rows = []
        for each device in data.devices
            if device.kind = "phone" then rows.Push({title: device.name + "  /  Revoke", id: device.id, kind: "device"})
        end for
        showRows(rows, "devices")
    else if tag = "revoke"
        request("devices", "/devices")
    else if tag = "refresh"
        showMessage("Catalog refreshed", "Choose Live, Movies, or Series to browse the updated catalog.")
    else if tag = "issued"
        m.connection.text = "Playback requested..."
    else if tag = "episodes"
        m.episodes = data.items
        showSeasons()
    else if response.context.view = m.viewSerial
        if tag = "categories"
            rows = [{title: "All titles", id: "", kind: "category"}]
            for each category in data.categories
                category.kind = "category"
                rows.Push(category)
            end for
            showRows(rows, "categories")
        else if tag = "catalog"
            rows = data.items
            if m.page > 1 then rows.Push({title: "Previous page", kind: "previous"})
            if m.page * data.pageSize < data.total then rows.Push({title: "Next page", kind: "next"})
            showRows(rows, "catalog")
            m.connection.text = "Page " + m.page.ToStr() + "  |  " + data.total.ToStr() + " titles"
        else if tag = "continue"
            rows = []
            for each progress in data.items
                if progress.item <> invalid
                    rows.Push(progress.item)
                else
                    rows.Push({id: progress.contentId, title: progress.contentId})
                end if
            end for
            showRows(rows, "continue")
        end if
    end if
end sub

sub nextCommand()
    if m.commandBusy or m.commands.Count() = 0 then return
    command = m.commands.Shift()
    m.commandBusy = true
    m.activeCommand = command
    expires = CreateObject("roDateTime")
    expires.FromISO8601String(command.expiresAt)
    now = CreateObject("roDateTime")
    if command.status <> "pending" or expires.AsSeconds() <= now.AsSeconds()
        finishCommand(command, false, "Command expired or no longer pending.")
        return
    end if
    if command.action = "play"
        m.targetSession = command.sessionId
        m.resolvingCommand = command
        m.connection.text = "Resolving stream... Press Back to cancel."
        print "AOA stage resolve_started"
        request("resolve", "/roku/playback/" + uri(command.id), "GET", invalid, command)
        return
    end if
    if m.playback = invalid
        finishCommand(command, false, "No active playback session.")
        return
    end if
    if command.sessionId <> m.playback.sessionId
        finishCommand(command, false, "Stale playback session.")
        return
    end if
    if command.action = "subtitles"
        m.resolvingCommand = command
        request("resolve", "/roku/playback/" + uri(command.id), "GET", invalid, command)
        return
    else if command.action = "pause"
        m.video.control = "pause"
    else if command.action = "resume"
        m.video.control = "resume"
    else if command.action = "stop"
        stopPlayback()
    else if command.action = "seek"
        if m.playback.item.type = "live"
            finishCommand(command, false, "Seeking is unavailable for live channels.")
            return
        end if
        position = command.position
        if position = invalid or position < 0
            finishCommand(command, false, "Invalid seek position.")
            return
        end if
        if m.video.duration > 0 and position > m.video.duration then position = m.video.duration
        m.video.seek = position
    else
        finishCommand(command, false, "Unsupported command.")
        return
    end if
    updateSnapshot(true)
    finishCommand(command, true)
end sub

sub finishCommand(command as object, success as boolean, message = "" as string)
    status = "acknowledged"
    if not success then status = "failed"
    request("ack", "/roku/commands/" + uri(command.id) + "/ack", "POST", {status: status, error: message})
    if m.activeCommand <> invalid
        if m.activeCommand.id = command.id
            m.activeCommand = invalid
            m.resolvingCommand = invalid
            m.commandBusy = false
            nextCommand()
        end if
    end if
end sub

sub resolveCommand(response as object)
    command = response.context.extra
    if m.activeCommand = invalid then return
    if m.activeCommand.id <> command.id or m.targetSession <> command.sessionId
        print "AOA stage resolve_stale"
        return
    end if
    m.resolvingCommand = invalid
    if not response.ok
        finishCommand(command, false, response.error)
        showMessage("Cannot start playback", response.error)
        return
    end if
    playback = response.data
    if command.sessionId <> playback.sessionId
        finishCommand(command, false, "Playback session changed.")
        return
    end if
    expires = CreateObject("roDateTime")
    expires.FromISO8601String(command.expiresAt)
    now = CreateObject("roDateTime")
    if expires.AsSeconds() <= now.AsSeconds()
        finishCommand(command, false, "Command expired while resolving playback.")
        return
    end if
    reloading = command.action = "subtitles"
    if reloading
        if m.playback = invalid
            finishCommand(command, false, "Playback ended before subtitle reload.")
            return
        end if
        if m.playback.sessionId <> command.sessionId
            finishCommand(command, false, "Stale subtitle session.")
            return
        end if
        playback.position = m.currentPosition
        m.reloadPaused = m.video.state = "paused"
    else
        m.reloadPaused = false
        if m.playback <> invalid then updateSnapshot(true)
    end if
    if playback.url = invalid or playback.url = "" or playback.streamFormat = invalid
        finishCommand(command, false, "Backend returned no playable stream.")
        return
    end if
    format = LCase(playback.streamFormat)
    if format = "mov" or format = "m4v" then format = "mp4"
    if format = "m3u8" then format = "hls"
    if format = "mpd" then format = "dash"
    if format <> "mp4" and format <> "hls" and format <> "dash" and format <> "ism" and format <> "mkv"
        finishCommand(command, false, "Unsupported Roku stream container: " + format)
        showMessage("Unsupported stream", "This Roku client cannot play the provider container " + format + ". Select a compatible stream.")
        return
    end if
    m.video.control = "stop"
    content = CreateObject("roSGNode", "ContentNode")
    content.url = playback.url
    content.streamFormat = format
    content.title = textValue(playback.item.title)
    content.HttpCertificatesFile = "common:/certs/ca-bundle.crt"
    content.live = playback.item.type = "live"
    if not content.live and playback.position > 0 then content.PlayStart = playback.position
    m.selectedSubtitleTrack = textValue(playback.subtitleUrl)
    m.selectSubtitleWhenAvailable = m.selectedSubtitleTrack <> ""
    if m.selectSubtitleWhenAvailable
        ' Native metadata AA keys are case-sensitive; unquoted keys become lowercase.
        content.SubtitleTracks = [{"Language": "eng", "Description": "Selected English subtitles", "TrackName": m.selectedSubtitleTrack}]
        content.SubtitleConfig = {"TrackName": m.selectedSubtitleTrack}
    end if
    m.playback = playback
    m.lastSession = playback.sessionId
    m.lastContent = playback.item.id
    m.currentPosition = playback.position
    if not reloading then m.currentDuration = 0
    m.playState = "buffering"
    m.selectionSerial++
    m.details.visible = false
    if m.top.dialog <> invalid then m.top.dialog.close = true
    m.video.content = content
    m.video.subtitleTrack = m.selectedSubtitleTrack
    if m.selectedSubtitleTrack <> ""
        m.video.globalCaptionMode = "On"
        print "AOA stage subtitles_enabled"
    else
        m.video.globalCaptionMode = "Off"
        print "AOA stage subtitles_disabled"
    end if
    m.video.visible = true
    m.video.SetFocus(true)
    m.awaitingPlay = command
    m.watchdog.control = "start"
    m.video.control = "play"
    print "AOA stage video_start"
    updateSnapshot(true)
end sub

sub playbackTimedOut()
    if m.awaitingPlay = invalid then return
    command = m.awaitingPlay
    m.awaitingPlay = invalid
    m.playState = "error"
    updateSnapshot(true)
    m.playback = invalid
    m.video.control = "stop"
    m.video.visible = false
    restoreBrowseFocus()
    updateSnapshot(true)
    showMessage("Stream timed out", "The stream did not start within 25 seconds. Check the provider connection or try another title.")
    finishCommand(command, false, "Stream did not reach playing state within 25 seconds.")
    refreshContinue()
end sub

sub videoPositionChanged()
    if m.playback <> invalid and (m.video.state = "playing" or m.video.state = "paused")
        m.currentPosition = m.video.position
        m.currentDuration = m.video.duration
    end if
    updateSnapshot(false)
end sub

sub subtitleTracksChanged()
    if not m.selectSubtitleWhenAvailable then return
    for each track in m.video.availableSubtitleTracks
        if textValue(track["TrackName"]) = m.selectedSubtitleTrack
            m.video.subtitleTrack = m.selectedSubtitleTrack
            m.video.globalCaptionMode = "On"
            m.selectSubtitleWhenAvailable = false
            print "AOA stage subtitle_track_available"
            return
        end if
    end for
end sub

sub subtitleTrackChanged()
    if m.selectedSubtitleTrack <> "" and m.video.currentSubtitleTrack = m.selectedSubtitleTrack then print "AOA stage subtitle_track_selected"
end sub

sub videoStateChanged()
    if m.playback = invalid then return
    state = m.video.state
    print "AOA stage video_state "; state
    m.playState = state
    if state = "playing" and m.reloadPaused
        m.reloadPaused = false
        m.video.control = "pause"
    end if
    if m.awaitingPlay <> invalid and (state = "playing" or state = "error" or state = "finished")
        command = m.awaitingPlay
        m.awaitingPlay = invalid
        m.watchdog.control = "stop"
        success = state = "playing"
        message = ""
        if not success then message = "Stream failed before playback began. Roku error " + textValue(m.video.errorCode)
        finishCommand(command, success, message)
    end if
    updateSnapshot(true)
    if state = "error"
        m.video.visible = false
        restoreBrowseFocus()
        showMessage("Stream cannot play", "The stream is disconnected, unavailable, or uses a codec/container unsupported by this Roku. Try another title. Error " + textValue(m.video.errorCode) + ".")
        m.playback = invalid
        updateSnapshot(true)
        refreshContinue()
    else if state = "finished"
        m.video.visible = false
        restoreBrowseFocus()
        m.playback = invalid
        updateSnapshot(true)
        refreshContinue()
    end if
end sub

sub updateSnapshot(sendNow as boolean)
    status = {online: true, state: m.playState}
    if m.lastSession <> ""
        status["sessionId"] = m.lastSession
        status["contentId"] = m.lastContent
    end if
    progress = invalid
    if m.playback <> invalid
        position = m.currentPosition
        duration = m.currentDuration
        if position = invalid or position < 0 then position = 0
        if duration = invalid or duration < 0 then duration = 0
        status["contentId"] = m.playback.item.id
        status["sessionId"] = m.playback.sessionId
        status.position = position
        status.duration = duration
        if m.playback.item.type <> "live"
            completed = m.playState = "finished"
            if duration > 0 and position / duration >= 0.95 then completed = true
            progress = {"contentId": status.contentId, "sessionId": status.sessionId, position: position, duration: duration, completed: completed}
        end if
    end if
    m.net.snapshot = {status: status, progress: progress}
    if sendNow and m.configured
        request("heartbeat", "/roku/status", "POST", status)
        if progress <> invalid then request("progress", "/roku/progress", "PUT", progress)
    end if
end sub

sub stopPlayback()
    m.selectSubtitleWhenAvailable = false
    pending = m.awaitingPlay
    if pending = invalid then pending = m.resolvingCommand
    m.awaitingPlay = invalid
    m.resolvingCommand = invalid
    m.watchdog.control = "stop"
    m.playState = "stopped"
    updateSnapshot(true)
    m.playback = invalid
    m.video.control = "stop"
    m.video.visible = false
    restoreBrowseFocus()
    updateSnapshot(true)
    if pending <> invalid then finishCommand(pending, false, "Playback cancelled before the stream started.")
    refreshContinue()
end sub

sub restoreBrowseFocus()
    m.selectSubtitleWhenAvailable = false
    m.details.visible = false
    m.selectionSerial++
    m.list.SetFocus(true)
end sub

sub refreshContinue()
    if m.configured and m.nav = 0 and not m.video.visible and not m.details.visible then request("continue", "/progress")
end sub

function onKeyEvent(key as string, press as boolean) as boolean
    if not press then return false
    if key = "back" and m.top.dialog <> invalid
        m.top.dialog.close = true
        return true
    end if
    if m.video.visible
        if key = "back"
            stopPlayback()
            return true
        end if
        return false
    end if
    if key = "back" and (m.resolvingCommand <> invalid or m.issuingPlay)
        m.selectionSerial++
        m.issuingPlay = false
        stopPlayback()
        return true
    end if
    if m.details.visible
        if key = "back"
            m.selectionSerial++
            m.details.visible = false
            m.list.SetFocus(true)
            return true
        else if key = "options"
            toggleFavorite(m.selected)
            return true
        end if
        return false
    end if
    if key = "left"
        m.menu.SetFocus(true)
        return true
    else if key = "right" and m.menu.HasFocus()
        m.list.SetFocus(true)
        return true
    else if key = "options" and m.list.HasFocus()
        index = m.list.itemFocused
        if index >= 0 and index < m.rows.Count()
            row = m.rows[index]
            if row.id <> invalid and row.type <> invalid then toggleFavorite(row)
        end if
        return true
    else if key = "back"
        if m.mode = "episodes"
            showSeasons()
        else if m.mode = "devices"
            settings()
        else if m.mode = "catalog" and m.query = ""
            request("categories", "/categories?type=" + m.mediaType)
        else if not m.menu.HasFocus()
            m.menu.SetFocus(true)
        else
            return false
        end if
        return true
    end if
    return false
end function
