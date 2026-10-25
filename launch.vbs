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
    
    ' Wait until server is fully ready to accept connections (Polling up to 6 seconds)
    For i = 1 To 12
        WScript.Sleep 500
        On Error Resume Next
        Set checkHttp = CreateObject("MSXML2.ServerXMLHTTP.6.0")
        checkHttp.setTimeouts 500, 500, 500, 500
        checkHttp.open "GET", "http://127.0.0.1:4545/api/status", False
        checkHttp.send
        If Err.Number = 0 Then
            If checkHttp.status = 200 Then
                Exit For
            End If
        End If
        On Error GoTo 0
    Next
End If

' App Mode Window Launcher (Stand-alone window like a real desktop app)
localAppData = WshShell.ExpandEnvironmentStrings("%LOCALAPPDATA%")
appUrl = "http://localhost:4545"

browserPaths = Array( _
    "C:\Program Files\Google\Chrome\Application\chrome.exe", _
    "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe", _
    localAppData & "\Google\Chrome\Application\chrome.exe", _
    "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe", _
    "C:\Program Files\Microsoft\Edge\Application\msedge.exe", _
    localAppData & "\Microsoft\Edge\Application\msedge.exe" _
)

foundBrowser = ""
For Each bp In browserPaths
    If fso.FileExists(bp) Then
        foundBrowser = bp
        Exit For
    End If
Next

If foundBrowser <> "" Then
    ' Launch in standalone desktop application window mode without URL bar or browser tabs
    WshShell.Run """" & foundBrowser & """ --app=""" & appUrl & """", 1, False
Else
    ' Fallback to default browser
    WshShell.Run appUrl, 1, False
End If
