' Double-click to open the resume editor without a command window.
' Starts the server hidden if it is not already running, then opens the browser.
' Use the "Stop server" button in the editor to shut it down.

Option Explicit

Const editorUrl = "http://127.0.0.1:3000/"

Dim shell, fso, folder, i
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)

Function ServerIsUp()
  Dim http
  ServerIsUp = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.Open "GET", editorUrl & "api/documents", False
  http.Send
  If Err.Number = 0 Then ServerIsUp = (http.Status = 200)
  On Error GoTo 0
End Function

If Not ServerIsUp() Then
  shell.CurrentDirectory = folder
  ' 0 = hidden window, False = don't wait for it to exit.
  shell.Run "node server.js", 0, False

  For i = 1 To 30
    WScript.Sleep 500
    If ServerIsUp() Then Exit For
  Next

  If Not ServerIsUp() Then
    MsgBox "The resume editor did not start." & vbCrLf & vbCrLf & _
      "Check that Node.js is installed and that nothing else is using port 3000. " & _
      "To see the error, open Command Prompt in this folder and run: npm start", _
      vbExclamation, "Resume Editor"
    WScript.Quit 1
  End If
End If

shell.Run editorUrl
