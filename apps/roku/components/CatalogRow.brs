sub init()
    m.text = m.top.FindNode("text")
    m.image = m.top.FindNode("image")
end sub

sub showContent()
    item = m.top.itemContent
    if item = invalid then return
    m.text.text = item.title
    m.image.uri = item.titleImage
    m.image.visible = item.titleImage <> ""
    m.text.visible = not m.image.visible
end sub
