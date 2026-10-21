Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
currentDir = fso.GetParentFolderName(WScript.ScriptFullName)

' Check if server is already running on port 4545
isServerRunning = False
On Error Resume Next
Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
http.setTimeouts 1000, 1000, 1000, 1000
http.open "GET", "http://127.0.0.1:4545/api/status", False
http.send
If Err.Number = 0 Then
    If http.status = 200 Then
        isServerRunning = True
    End If
End If
On Error GoTo 0

' Start node server if not already running
If Not isServerRunning Then
    WshShell.CurrentDirectory = currentDir
    WshShell.Run "cmd /c node server.js", 0, False
    WScript.Sleep 800
End If

' Open in User's Default Browser
WshShell.Run "http://localhost:4545", 1, False
