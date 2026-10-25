using System;
using System.Drawing;
using System.Windows.Forms;
using System.Threading;

class DummyGame : Form {
    [STAThread]
    static void Main(string[] args) {
        string title = "Roblox";
        if (args != null && args.Length > 0 && !string.IsNullOrEmpty(args[0])) {
            title = args[0];
        }
        DummyGame form = new DummyGame();
        form.Text = title;
        form.ShowInTaskbar = false;
        form.WindowState = FormWindowState.Minimized;
        form.Size = new Size(100, 100);
        form.Opacity = 0.01;
        Application.Run(form);
    }
}
