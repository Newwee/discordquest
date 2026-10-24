using System;
using System.Threading;
using System.Runtime.InteropServices;

class DummyGame {
    [DllImport("kernel32.dll")] static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")] static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
    [DllImport("user32.dll")] static extern bool SetWindowText(IntPtr hWnd, string text);

    static void Main(string[] args) {
        try {
            string title = args.Length > 0 ? args[0] : "Discord Game";
            Console.Title = title;
            IntPtr hWnd = GetConsoleWindow();
            if (hWnd != IntPtr.Zero) {
                SetWindowText(hWnd, title);
                // SW_SHOWMINNOACTIVE = 7: Displays the window as a minimized window without stealing focus.
                ShowWindow(hWnd, 7);
            }
        } catch {}
        while (true) Thread.Sleep(10000);
    }
}
