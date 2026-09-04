using System;
using System.Diagnostics;
using System.IO;
using System.Net;
using System.Reflection;
using System.Threading;
using System.Windows.Forms;

[assembly: AssemblyTitle("JamesPDF")]
[assembly: AssemblyDescription("James PDF 4.2.2 launcher")]
[assembly: AssemblyCompany("Cybereun")]
[assembly: AssemblyProduct("James PDF")]
[assembly: AssemblyCopyright("Copyright (C) 2026 Cybereun")]
[assembly: AssemblyFileVersion("4.2.2.0")]
[assembly: AssemblyVersion("4.2.2.0")]

internal static class Program
{
    private const int DefaultPort = 5200;
    private const string AppVersion = "4.2.2";
    private const string AppTitle = "James PDF " + AppVersion;

    [STAThread]
    private static int Main(string[] args)
    {
        try
        {
            int port = ParsePort(args);
            bool noBrowser = HasArg(args, "--no-browser");
            bool checkOnly = HasArg(args, "--check-only");

            string baseDir = GetExecutableDirectory();
            string appDir = Path.Combine(baseDir, "app");
            string serverScript = Path.Combine(appDir, "server.js");
            string nodeExe = Path.Combine(baseDir, "node.exe");

            if (!File.Exists(serverScript))
            {
                ShowError(
                    AppTitle + " source file was not found.\n\n" +
                    "Expected path:\n" + serverScript + "\n\n" +
                    "Please reinstall " + AppTitle + " or check the installer package structure.");
                return 2;
            }

            if (!File.Exists(nodeExe))
            {
                ShowError(
                    "Bundled Node.js runtime was not found.\n\n" +
                    "Expected path:\n" + nodeExe + "\n\n" +
                    "Please reinstall " + AppTitle + ".");
                return 3;
            }

            if (checkOnly)
            {
                return 0;
            }

            string url = "http://localhost:" + port + "/";
            if (!IsJamesPdfReady(port))
            {
                StartServer(nodeExe, appDir, port);
                if (!WaitForJamesPdf(port, 15000))
                {
                    ShowError(
                        AppTitle + " server did not start.\n\n" +
                        "The port " + port + " may already be in use, or a dependency failed to load.\n" +
                        "Try reinstalling " + AppTitle + " and run it again.");
                    return 4;
                }
            }

            if (!noBrowser)
            {
                OpenAppWindow(url);
            }

            return 0;
        }
        catch (Exception ex)
        {
            ShowError(AppTitle + " failed to launch.\n\n" + ex.Message);
            return 1;
        }
    }

    private static string GetExecutableDirectory()
    {
        string location = Assembly.GetExecutingAssembly().Location;
        string dir = Path.GetDirectoryName(location);
        if (!String.IsNullOrEmpty(dir))
        {
            return dir;
        }

        return AppDomain.CurrentDomain.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);
    }

    private static void StartServer(string nodeExe, string appDir, int port)
    {
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = nodeExe;
        info.Arguments = "\"server.js\"";
        info.WorkingDirectory = appDir;
        info.UseShellExecute = false;
        info.CreateNoWindow = true;
        info.WindowStyle = ProcessWindowStyle.Hidden;
        info.EnvironmentVariables["PORT"] = port.ToString();

        Process.Start(info);
    }

    private static bool WaitForJamesPdf(int port, int timeoutMs)
    {
        Stopwatch watch = Stopwatch.StartNew();
        while (watch.ElapsedMilliseconds < timeoutMs)
        {
            if (IsJamesPdfReady(port))
            {
                return true;
            }

            Thread.Sleep(500);
        }

        return false;
    }

    private static bool IsJamesPdfReady(int port)
    {
        try
        {
            string body = ReadUrl("http://127.0.0.1:" + port + "/api/health", 3000);
            return body.IndexOf("\"version\":\"" + AppVersion + "\"", StringComparison.OrdinalIgnoreCase) >= 0 ||
                   body.IndexOf("\"appName\":\"JamePDF V" + AppVersion + "\"", StringComparison.OrdinalIgnoreCase) >= 0;
        }
        catch
        {
            return false;
        }
    }

    private static string ReadUrl(string url, int timeoutMs)
    {
        HttpWebRequest request = (HttpWebRequest)WebRequest.Create(url);
        request.Method = "GET";
        request.Timeout = timeoutMs;
        request.ReadWriteTimeout = timeoutMs;

        using (HttpWebResponse response = (HttpWebResponse)request.GetResponse())
        using (Stream stream = response.GetResponseStream())
        using (StreamReader reader = new StreamReader(stream))
        {
            return reader.ReadToEnd();
        }
    }

    private static void OpenAppWindow(string url)
    {
        string browserExe = FindChromiumBrowser();
        if (String.IsNullOrEmpty(browserExe))
        {
            OpenBrowser(url);
            return;
        }

        string profileDir = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "JamesPDF",
            "AppWindowProfile");
        Directory.CreateDirectory(profileDir);

        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = browserExe;
        info.Arguments =
            "--app=" + QuoteArgument(url) +
            " --user-data-dir=" + QuoteArgument(profileDir) +
            " --no-first-run" +
            " --no-default-browser-check" +
            " --disable-default-apps" +
            " --disable-features=Translate";
        info.UseShellExecute = false;
        info.CreateNoWindow = false;
        Process.Start(info);
    }

    private static string FindChromiumBrowser()
    {
        string programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        string programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        string localAppData = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);

        string[] candidates = new string[]
        {
            Path.Combine(programFilesX86, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(programFiles, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(localAppData, "Microsoft", "Edge", "Application", "msedge.exe"),
            Path.Combine(programFiles, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(programFilesX86, "Google", "Chrome", "Application", "chrome.exe"),
            Path.Combine(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
        };

        foreach (string candidate in candidates)
        {
            if (!String.IsNullOrEmpty(candidate) && File.Exists(candidate))
            {
                return candidate;
            }
        }

        string fromPath = FindOnPath("msedge.exe");
        if (!String.IsNullOrEmpty(fromPath))
        {
            return fromPath;
        }

        return FindOnPath("chrome.exe");
    }

    private static string FindOnPath(string fileName)
    {
        string pathValue = Environment.GetEnvironmentVariable("PATH") ?? String.Empty;
        string[] dirs = pathValue.Split(Path.PathSeparator);
        foreach (string dir in dirs)
        {
            try
            {
                if (String.IsNullOrWhiteSpace(dir))
                {
                    continue;
                }

                string candidate = Path.Combine(dir.Trim(), fileName);
                if (File.Exists(candidate))
                {
                    return candidate;
                }
            }
            catch
            {
            }
        }

        return String.Empty;
    }

    private static string QuoteArgument(string value)
    {
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }

    private static void OpenBrowser(string url)
    {
        ProcessStartInfo info = new ProcessStartInfo();
        info.FileName = url;
        info.UseShellExecute = true;
        Process.Start(info);
    }

    private static bool HasArg(string[] args, string name)
    {
        foreach (string arg in args)
        {
            if (String.Equals(arg, name, StringComparison.OrdinalIgnoreCase))
            {
                return true;
            }
        }

        return false;
    }

    private static int ParsePort(string[] args)
    {
        foreach (string arg in args)
        {
            if (arg.StartsWith("--port=", StringComparison.OrdinalIgnoreCase))
            {
                int port;
                if (Int32.TryParse(arg.Substring("--port=".Length), out port) && port > 0 && port < 65536)
                {
                    return port;
                }
            }
        }

        return DefaultPort;
    }

    private static void ShowError(string message)
    {
        MessageBox.Show(message, AppTitle, MessageBoxButtons.OK, MessageBoxIcon.Error);
    }
}

