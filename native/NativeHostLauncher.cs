using System;
using System.Diagnostics;
using System.IO;
using System.Reflection;
using System.Threading;

internal static class NativeHostLauncher
{
    private static int Main(string[] args)
    {
        try
        {
            string baseDir = Path.GetDirectoryName(Assembly.GetExecutingAssembly().Location);
            string nodePathFile = Path.Combine(baseDir, "node-path.txt");
            string nodePath = File.Exists(nodePathFile)
                ? File.ReadAllText(nodePathFile).Trim()
                : "node.exe";
            string scriptPath = Path.GetFullPath(Path.Combine(baseDir, "..", "bridge", "native-host.js"));

            ProcessStartInfo startInfo = new ProcessStartInfo
            {
                FileName = nodePath,
                Arguments = Quote(scriptPath) + BuildForwardedArguments(args),
                UseShellExecute = false,
                RedirectStandardInput = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };

            using (Process process = Process.Start(startInfo))
            {
                Stream browserInput = Console.OpenStandardInput();
                Stream browserOutput = Console.OpenStandardOutput();
                Stream browserError = Console.OpenStandardError();

                Thread inputThread = StartCopyThread(browserInput, process.StandardInput.BaseStream, true);
                Thread outputThread = StartCopyThread(process.StandardOutput.BaseStream, browserOutput, false);
                Thread errorThread = StartCopyThread(process.StandardError.BaseStream, browserError, false);

                process.WaitForExit();
                inputThread.Join(1000);
                outputThread.Join(1000);
                errorThread.Join(1000);
                return process.ExitCode;
            }
        }
        catch (Exception error)
        {
            Console.Error.WriteLine(error.ToString());
            return 1;
        }
    }

    private static Thread StartCopyThread(Stream source, Stream destination, bool closeDestination)
    {
        Thread thread = new Thread(() =>
        {
            byte[] buffer = new byte[8192];
            try
            {
                int bytesRead;
                while ((bytesRead = source.Read(buffer, 0, buffer.Length)) > 0)
                {
                    destination.Write(buffer, 0, bytesRead);
                    destination.Flush();
                }
                if (closeDestination)
                {
                    destination.Close();
                }
            }
            catch
            {
                if (closeDestination)
                {
                    try { destination.Close(); } catch { }
                }
            }
        });
        thread.IsBackground = true;
        thread.Start();
        return thread;
    }

    private static string BuildForwardedArguments(string[] args)
    {
        if (args == null || args.Length == 0)
        {
            return string.Empty;
        }

        string result = string.Empty;
        foreach (string arg in args)
        {
            result += " " + Quote(arg);
        }
        return result;
    }

    private static string Quote(string value)
    {
        if (value == null)
        {
            return "\"\"";
        }
        return "\"" + value.Replace("\"", "\\\"") + "\"";
    }
}
