using System;
using System.Threading;
using System.Runtime.InteropServices;

class DummyGame {
    [DllImport("kernel32.dll")]
    static extern IntPtr GetConsoleWindow();
    [DllImport("user32.dll")]
    static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);

    static void Main() {
        IntPtr hWnd = GetConsoleWindow();
        if (hWnd != IntPtr.Zero) {
            ShowWindow(hWnd, 0); // SW_HIDE
        }
        while (true) {
            Thread.Sleep(10000);
        }
    }
}
