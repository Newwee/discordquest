using System;
using System.IO;
using System.IO.Compression;
using System.Drawing;
using System.Windows.Forms;
using System.Reflection;
using System.Diagnostics;

namespace DiscordQuestAutoInstaller
{
    public class SetupForm : Form
    {
        private Label lblDest;
        private TextBox txtDest;
        private Button btnBrowse;
        private GroupBox grpDesc;
        private TextBox txtDesc;
        private GroupBox grpTerms;
        private TextBox txtTerms;
        private CheckBox chkAccept;
        private ProgressBar progressBar;
        private Label lblStatus;
        private Button btnInstall;
        private Button btnCancel;
        private Button btnLaunch;

        public SetupForm()
        {
            InitializeComponent();
        }

        private void InitializeComponent()
        {
            this.Text = "Discord Quest Auto Setup";
            this.Size = new Size(580, 680);
            this.StartPosition = FormStartPosition.CenterScreen;
            this.FormBorderStyle = FormBorderStyle.FixedDialog;
            this.MaximizeBox = false;
            this.BackColor = Color.FromArgb(245, 246, 250);
            this.Font = new Font("Segoe UI", 9F, FontStyle.Regular);

            try
            {
                if (File.Exists("icon.ico"))
                {
                    this.Icon = new Icon("icon.ico");
                }
            }
            catch { }

            // Top Header Panel
            Panel pnlHeader = new Panel
            {
                Dock = DockStyle.Top,
                Height = 68,
                BackColor = Color.FromArgb(18, 20, 32)
            };

            Label lblTitle = new Label
            {
                Text = "Discord Quest Auto v2.0 Setup",
                ForeColor = Color.FromArgb(0, 255, 204),
                Font = new Font("Segoe UI", 12F, FontStyle.Bold),
                Location = new Point(16, 12),
                AutoSize = true
            };

            Label lblSub = new Label
            {
                Text = "Automated Discord Quest Engine • Safe Mode (No AutoClaim)",
                ForeColor = Color.FromArgb(160, 165, 185),
                Font = new Font("Segoe UI", 8.5F, FontStyle.Regular),
                Location = new Point(17, 38),
                AutoSize = true
            };

            pnlHeader.Controls.Add(lblTitle);
            pnlHeader.Controls.Add(lblSub);
            this.Controls.Add(pnlHeader);

            int currentY = 80;

            // 1. Destination Folder
            lblDest = new Label
            {
                Text = "Destination folder:",
                Location = new Point(20, currentY),
                AutoSize = true,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };
            this.Controls.Add(lblDest);
            currentY += 22;

            string defaultPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "DiscordQuestAuto");
            txtDest = new TextBox
            {
                Text = defaultPath,
                Location = new Point(20, currentY),
                Size = new Size(440, 24),
                Font = new Font("Segoe UI", 9F)
            };
            this.Controls.Add(txtDest);

            btnBrowse = new Button
            {
                Text = "...",
                Location = new Point(470, currentY - 1),
                Size = new Size(75, 26),
                Font = new Font("Segoe UI", 9F, FontStyle.Bold)
            };
            btnBrowse.Click += (s, e) =>
            {
                using (FolderBrowserDialog fbd = new FolderBrowserDialog())
                {
                    fbd.Description = "Select Destination Folder for Discord Quest Auto:";
                    fbd.SelectedPath = txtDest.Text;
                    if (fbd.ShowDialog() == DialogResult.OK)
                    {
                        txtDest.Text = fbd.SelectedPath;
                    }
                }
            };
            this.Controls.Add(btnBrowse);
            currentY += 34;

            // 2. Detailed Description (เขียน des. เยอะๆ)
            grpDesc = new GroupBox
            {
                Text = "รายละเอียดโปรแกรม (Application Description & Features):",
                Location = new Point(20, currentY),
                Size = new Size(525, 150),
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold)
            };

            txtDesc = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BackColor = Color.White,
                Location = new Point(10, 20),
                Size = new Size(505, 120),
                Font = new Font("Segoe UI", 8.5F),
                Text = "★ DISCORD QUEST AUTO v2.1.0 ★" + Environment.NewLine + Environment.NewLine +
                       "• ระบบช่วยทำ Discord Quests อัตโนมัติในเครื่องของคุณ (Localhost Engine)" + Environment.NewLine +
                       "• รองรับเควสต์ดูคลิปวิดีโอ (WATCH_VIDEO) 100% โดยไม่ต้องเปิดคลิปแช่ทิ้งไว้" + Environment.NewLine +
                       "• คำนวณยอด Discord Orbs รวมแบบสดๆ และบอกว่ามีเควสต์ที่พร้อมเคลมกี่รางวัล" + Environment.NewLine +
                       "• ปลอดภัยสูงสุดด้วย SAFE MODE (No AutoClaim): ระบบจะไม่กดรับของรางวัลอัตโนมัติ เพื่อเลี่ยง Captcha และป้องกันการตรวจจับ 100%" + Environment.NewLine +
                       "• ระบบถอดรหัส Token อัตโนมัติในเครื่อง (Local DPAPI Scanner) ปลอดภัย ไม่หลุดออกภายนอก" + Environment.NewLine +
                       "• ระบบบันทึกประวัติบัญชี (Account History & Switcher) สลับไอดีได้ในคลิกเดียว" + Environment.NewLine +
                       "• ระบบตรวจสอบอัปเดตอัตโนมัติจาก GitHub (Newwee/discordquest) แจ้งเตือนเมื่อมีเวอร์ชันใหม่" + Environment.NewLine +
                       "• คู่มือการใช้งานแบบโต้ตอบ (Interactive User Guide) แนะนำฟีเจอร์สำหรับผู้ใช้ใหม่" + Environment.NewLine +
                       "• รองรับทุกขนาดหน้าจอ (1:1, 16:9, 4:3, Mobile) พร้อมเอฟเฟกต์ธีม ReactBits"
            };
            grpDesc.Controls.Add(txtDesc);
            this.Controls.Add(grpDesc);
            currentY += 158;

            // 3. Terms & Conditions (ข้อตกลงและเงื่อนไข)
            grpTerms = new GroupBox
            {
                Text = "ข้อตกลงและเงื่อนไขการใช้งาน (Terms of Agreement & Disclaimer):",
                Location = new Point(20, currentY),
                Size = new Size(525, 130),
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold)
            };

            txtTerms = new TextBox
            {
                Multiline = true,
                ReadOnly = true,
                ScrollBars = ScrollBars.Vertical,
                BackColor = Color.White,
                Location = new Point(10, 20),
                Size = new Size(505, 100),
                Font = new Font("Segoe UI", 8.5F),
                Text = "โปรดอ่านและทำความเข้าใจข้อตกลงก่อนเริ่มติดตั้ง:" + Environment.NewLine + Environment.NewLine +
                       "1. วัตถุประสงค์: ซอฟต์แวร์นี้จัดทำขึ้นเพื่อการศึกษา วิจัย และทดสอบทางเทคนิคภายในเครื่องส่วนบุคคลเท่านั้น" + Environment.NewLine +
                       "2. ความเป็นส่วนตัว: โปรแกรมทำงานเป็น Local Server บน IP 127.0.0.1 ภายในเครื่องของคุณเท่านั้น ไม่มีการส่งข้อมูล Token หรือรหัสผ่านไปยังเซิร์ฟเวอร์ภายนอกใดๆ ทั้งสิ้น" + Environment.NewLine +
                       "3. ความรับผิดชอบ: การใช้ระบบอัตโนมัติหรือสคริปต์กับบัญชี Discord อาจขัดต่อเงื่อนไขการให้บริการของ Discord (Terms of Service) ผู้ใช้งานตกลงยอมรับความเสี่ยงทั้งหมดที่อาจเกิดขึ้นกับบัญชีของตนเองโดยผู้พัฒนาไม่มีส่วนรับผิดชอบใดๆ ทั้งสิ้น" + Environment.NewLine +
                       "4. ข้อห้าม: ห้ามนำซอฟต์แวร์นี้ไปจำหน่ายต่อ ดัดแปลงเพื่อแสวงหาผลกำไร หรือใช้ในเจตนาทุจริตอย่างเด็ดขาด"
            };
            grpTerms.Controls.Add(txtTerms);
            this.Controls.Add(grpTerms);
            currentY += 136;

            // 4. Mandatory Checkbox (ให้ติ๊ก accept ทุกครั้งเวลา install)
            chkAccept = new CheckBox
            {
                Text = "ข้าพเจ้าได้อ่าน เข้าใจ และยอมรับข้อตกลงและเงื่อนไขการใช้งานทั้งหมด (I accept the Terms)",
                Location = new Point(22, currentY),
                Size = new Size(520, 24),
                ForeColor = Color.FromArgb(20, 30, 60),
                Font = new Font("Segoe UI", 8.5F, FontStyle.Bold)
            };
            chkAccept.CheckedChanged += (s, e) =>
            {
                btnInstall.Enabled = chkAccept.Checked;
            };
            this.Controls.Add(chkAccept);
            currentY += 30;

            // 5. Progress Bar & Status (Styled like 7-Zip green bar)
            lblStatus = new Label
            {
                Text = "Ready to install",
                Location = new Point(20, currentY),
                Size = new Size(525, 20),
                ForeColor = Color.FromArgb(70, 75, 90),
                Font = new Font("Segoe UI", 8.5F)
            };
            this.Controls.Add(lblStatus);
            currentY += 22;

            progressBar = new ProgressBar
            {
                Location = new Point(20, currentY),
                Size = new Size(525, 20),
                Minimum = 0,
                Maximum = 100,
                Value = 0
            };
            this.Controls.Add(progressBar);
            currentY += 30;

            // Bottom Buttons
            btnInstall = new Button
            {
                Text = "Install",
                Location = new Point(345, currentY),
                Size = new Size(95, 30),
                Enabled = false, // Disabled until checkbox is checked!
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                BackColor = Color.FromArgb(35, 165, 90),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnInstall.Click += BtnInstall_Click;
            this.Controls.Add(btnInstall);

            btnCancel = new Button
            {
                Text = "Cancel",
                Location = new Point(450, currentY),
                Size = new Size(95, 30),
                Font = new Font("Segoe UI", 9F)
            };
            btnCancel.Click += (s, e) => { this.Close(); };
            this.Controls.Add(btnCancel);

            btnLaunch = new Button
            {
                Text = "Launch Now",
                Location = new Point(345, currentY),
                Size = new Size(95, 30),
                Visible = false,
                Font = new Font("Segoe UI", 9F, FontStyle.Bold),
                BackColor = Color.FromArgb(88, 101, 242),
                ForeColor = Color.White,
                FlatStyle = FlatStyle.Flat
            };
            btnLaunch.Click += (s, e) =>
            {
                string targetVbs = Path.Combine(txtDest.Text, "launch.vbs");
                if (File.Exists(targetVbs))
                {
                    Process.Start("wscript.exe", "\"" + targetVbs + "\"");
                }
                this.Close();
            };
            this.Controls.Add(btnLaunch);
        }

        private void BtnInstall_Click(object sender, EventArgs e)
        {
            btnInstall.Enabled = false;
            chkAccept.Enabled = false;
            btnBrowse.Enabled = false;
            txtDest.Enabled = false;

            string targetDir = txtDest.Text.Trim();
            if (string.IsNullOrEmpty(targetDir)) return;

            Timer timer = new Timer { Interval = 40 };
            int step = 0;

            timer.Tick += (s, ev) =>
            {
                step += 3;
                if (step <= 30)
                {
                    lblStatus.Text = "Preparing installation directory...";
                    progressBar.Value = step;
                }
                else if (step == 33)
                {
                    lblStatus.Text = "Extracting payload files...";
                    try
                    {
                        Directory.CreateDirectory(targetDir);

                        // Extract embedded payload.zip resource
                        Assembly asm = Assembly.GetExecutingAssembly();
                        using (Stream stream = asm.GetManifestResourceStream("payload.zip"))
                        {
                            if (stream != null)
                            {
                                using (ZipArchive archive = new ZipArchive(stream))
                                {
                                    ExtractZipEntries(archive, targetDir);
                                }
                            }
                            else if (File.Exists("payload.zip"))
                            {
                                using (ZipArchive archive = ZipFile.OpenRead("payload.zip"))
                                {
                                    ExtractZipEntries(archive, targetDir);
                                }
                            }
                        }
                    }
                    catch (Exception ex)
                    {
                        timer.Stop();
                        MessageBox.Show("Extraction Error: " + ex.Message, "Error", MessageBoxButtons.OK, MessageBoxIcon.Error);
                        btnCancel.Text = "Close";
                        return;
                    }
                    progressBar.Value = 70;
                }
                else if (step <= 85)
                {
                    lblStatus.Text = "Creating Windows Start Menu & Desktop shortcuts...";
                    progressBar.Value = step;
                }
                else if (step >= 100)
                {
                    timer.Stop();
                    progressBar.Value = 100;

                    // Execute shortcut registration
                    try
                    {
                        string ps1 = Path.Combine(targetDir, "install_shortcut.ps1");
                        if (File.Exists(ps1))
                        {
                            ProcessStartInfo psi = new ProcessStartInfo
                            {
                                FileName = "powershell.exe",
                                Arguments = "-ExecutionPolicy Bypass -File \"" + ps1 + "\"",
                                WindowStyle = ProcessWindowStyle.Hidden,
                                WorkingDirectory = targetDir,
                                CreateNoWindow = true
                            };
                            Process p = Process.Start(psi);
                            if (p != null) p.WaitForExit(4000);
                        }
                    }
                    catch { }

                    lblStatus.Text = "Discord Quest Auto is installed successfully!";
                    lblStatus.ForeColor = Color.FromArgb(35, 165, 90);

                    btnInstall.Visible = false;
                    btnLaunch.Visible = true;
                    btnCancel.Text = "Close";

                    MessageBox.Show("Discord Quest Auto ได้รับการติดตั้งเรียบร้อยแล้ว!\nสามารถกดปุ่ม 'Launch Now' เพื่อเปิดใช้งานได้ทันที หรือพิมพ์ค้นหาในปุ่ม Start", "Installation Complete", MessageBoxButtons.OK, MessageBoxIcon.Information);
                }
            };

            timer.Start();
        }

        private static void ExtractZipEntries(ZipArchive archive, string destinationDir)
        {
            foreach (ZipArchiveEntry entry in archive.Entries)
            {
                string completeFileName = Path.GetFullPath(Path.Combine(destinationDir, entry.FullName));
                if (string.IsNullOrEmpty(entry.Name))
                {
                    Directory.CreateDirectory(completeFileName);
                }
                else
                {
                    string directoryPath = Path.GetDirectoryName(completeFileName);
                    if (!string.IsNullOrEmpty(directoryPath))
                    {
                        Directory.CreateDirectory(directoryPath);
                    }
                    entry.ExtractToFile(completeFileName, true);
                }
            }
        }

        [STAThread]
        static void Main()
        {
            Application.EnableVisualStyles();
            Application.SetCompatibleTextRenderingDefault(false);
            Application.Run(new SetupForm());
        }
    }
}
