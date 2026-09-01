import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui
import "FocusPleaseModel.js" as Model

Item {
  id: root

  property var shell: null
  property var manifest: null
  property var service: null

  property bool opened: false
  property bool moved: false
  property int cursorIndex: 0
  property int workspaceId: 0
  property int nextWorkspaceId: 0
  property string signature: ""
  property var suggested: []
  property var selected: ({})
  property bool confirmArmed: false

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color borderColor: Color.menu.border
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property color accent: Color.accent
  property var borderSpec: Border.surfaceSpec("menu", "border", root.borderColor, Math.max(1, Style.space(2)))
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int rowHeight: Math.max(Style.space(44), Style.font.body + Style.font.caption + Style.spacing.rowPaddingX * 2)
  property int headerHeight: Math.max(Style.space(52), Style.font.title + Style.font.caption + Style.spacing.md)
  property int footerHeight: Math.max(Style.space(48), Style.font.body + Style.spacing.controlPaddingY * 4)
  property int cardWidth: Math.min(Style.space(480), panel.width - Style.gapsOut * 2)
  property int listHeight: Math.min(windowModel.count * root.rowHeight, Style.space(320))
  property int cardHeight: Math.min(
    root.headerHeight + root.listHeight + root.footerHeight + root.contentMargin * 2,
    panel.height - Style.gapsOut * 2)

  ListModel {
    id: windowModel
  }

  function checkedCount() {
    var n = 0
    var sel = root.selected || {}
    var addr
    for (addr in sel) if (sel[addr]) n++
    return n
  }

  function isChecked(address) {
    return !!(root.selected && root.selected[address])
  }

  function isSuggested(address) {
    var list = root.suggested || []
    var i
    for (i = 0; i < list.length; i++) {
      if (String(list[i]) === String(address)) return true
    }
    return false
  }

  function loadWindows(windows) {
    windowModel.clear()
    var list = windows || []
    var sel = ({})
    var i
    for (i = 0; i < list.length; i++) {
      var w = list[i]
      var addr = String(w.address || "")
      var on = root.isSuggested(addr)
      if (on) sel[addr] = true
      windowModel.append({
        address: addr,
        title: String(w.title || w.cls || addr),
        cls: String(w.cls || ""),
        checked: on
      })
    }
    root.selected = sel
    root.cursorIndex = 0
  }

  function toggleAt(index) {
    if (index < 0 || index >= windowModel.count) return
    var addr = String(windowModel.get(index).address || "")
    if (!addr) return
    var sel = ({})
    var key
    for (key in root.selected) sel[key] = root.selected[key]
    if (sel[addr]) delete sel[addr]
    else sel[addr] = true
    root.selected = sel
    windowModel.setProperty(index, "checked", !!sel[addr])
  }

  function moveCursor(delta) {
    if (windowModel.count === 0) return
    var next = root.cursorIndex + delta
    if (next < 0) next = 0
    if (next >= windowModel.count) next = windowModel.count - 1
    root.cursorIndex = next
  }

  function open(payloadJson) {
    var data = Model.parseJson(payloadJson, {})
    if (!data || typeof data !== "object") data = {}
    root.moved = false
    root.workspaceId = Number(data.workspaceId || 0)
    root.nextWorkspaceId = Number(data.nextWorkspaceId || 0)
    root.signature = String(data.signature || "")
    root.suggested = data.suggested || []
    root.loadWindows(data.windows)
    if (windowModel.count === 0 || !(root.nextWorkspaceId > 0)) {
      if (root.service && typeof root.service.onMoveDialogClosed === "function")
        root.service.onMoveDialogClosed(false, root.signature)
      return
    }
    root.opened = true
    root.confirmArmed = false
    armTimer.restart()
    if (root.service && typeof root.service.onMoveDialogOpened === "function")
      root.service.onMoveDialogOpened()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    if (!root.opened) return
    root.opened = false
    if (root.service && typeof root.service.onMoveDialogClosed === "function")
      root.service.onMoveDialogClosed(root.moved, root.signature)
  }

  Timer {
    id: armTimer
    interval: 200
    repeat: false
    onTriggered: root.confirmArmed = true
  }

  function confirm() {
    if (!root.confirmArmed) return
    var addrs = []
    var addr
    for (addr in root.selected) if (root.selected[addr]) addrs.push(addr)
    if (!addrs.length) return
    root.moved = true
    if (root.service && typeof root.service.moveWindows === "function")
      root.service.moveWindows(addrs, root.nextWorkspaceId)
    root.close()
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "focusplease"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore
    onVisibleChanged: if (visible) Qt.callLater(function() { keyCatcher.forceActiveFocus() })

    Rectangle {
      anchors.fill: parent
      color: root.scrim
      MouseArea { anchors.fill: parent; onClicked: root.close() }
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: root.cardHeight
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; z: 0; onClicked: {} }

      FocusScope {
        id: keyCatcher
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        z: 1
        focus: true

        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            root.close()
            event.accepted = true
          } else if (event.key === Qt.Key_Up) {
            root.moveCursor(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Down) {
            root.moveCursor(1)
            event.accepted = true
          } else if (event.key === Qt.Key_Space) {
            root.toggleAt(root.cursorIndex)
            event.accepted = true
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            root.confirm()
            event.accepted = true
          }
        }

        Column {
          id: header
          anchors.top: parent.top
          width: parent.width
          spacing: Style.spacing.xs

          Text {
            width: parent.width
            text: "Workspace is full"
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.title
            elide: Text.ElideRight
          }

          Text {
            width: parent.width
            text: "Move selected windows to workspace " + root.nextWorkspaceId
            color: root.foreground
            opacity: 0.7
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            elide: Text.ElideRight
          }
        }

        Row {
          id: footer
          anchors.bottom: parent.bottom
          width: parent.width
          height: root.footerHeight
          z: 2
          spacing: Style.spacing.sm
          layoutDirection: Qt.RightToLeft

          Button {
            text: "Move"
            selected: root.checkedCount() > 0
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onClicked: root.confirm()
          }

          Button {
            text: "Keep here"
            bordered: true
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onClicked: root.close()
          }
        }

        ListView {
            id: list
            anchors.top: header.bottom
            anchors.topMargin: Style.spacing.sm
            anchors.bottom: footer.top
            anchors.bottomMargin: Style.spacing.sm
            width: parent.width
            clip: true
            model: windowModel
            spacing: 0
            boundsBehavior: Flickable.StopAtBounds
            currentIndex: root.cursorIndex

            delegate: Rectangle {
              required property int index
              required property string address
              required property string title
              required property string cls
              required property bool checked

              width: list.width
              height: root.rowHeight
              radius: root.cornerRadius
              color: index === root.cursorIndex ? root.selectedBackground : "transparent"

              MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                onClicked: {
                  root.cursorIndex = index
                  root.toggleAt(index)
                }
                onEntered: root.cursorIndex = index
              }

              Row {
                anchors.fill: parent
                anchors.leftMargin: Style.spacing.sm
                anchors.rightMargin: Style.spacing.sm
                spacing: Style.spacing.sm

                Rectangle {
                  width: Style.space(16)
                  height: Style.space(16)
                  radius: Style.space(3)
                  anchors.verticalCenter: parent.verticalCenter
                  color: checked ? root.accent : "transparent"
                  border.width: Math.max(1, Style.space(2))
                  border.color: checked ? root.accent : root.borderColor

                  Text {
                    anchors.centerIn: parent
                    visible: checked
                    text: "✓"
                    color: root.background
                    font.pixelSize: Style.font.caption
                    font.family: root.fontFamily
                  }
                }

                Column {
                  width: parent.width - Style.space(16) - Style.spacing.sm
                  anchors.verticalCenter: parent.verticalCenter
                  spacing: 0

                  Text {
                    width: parent.width
                    text: title
                    color: index === root.cursorIndex ? root.selectedText : root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.body
                    elide: Text.ElideRight
                  }

                  Text {
                    width: parent.width
                    text: cls
                    visible: cls.length > 0 && cls !== title
                    color: root.foreground
                    opacity: 0.55
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.caption
                    elide: Text.ElideRight
                  }
                }
              }
            }
          }
        }
      }
    }
  }

