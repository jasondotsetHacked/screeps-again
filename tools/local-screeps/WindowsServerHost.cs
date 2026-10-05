using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;
using System.Diagnostics;
using System.IO;

// A hidden console is inherited by the launcher's .cmd shims. A non-inherited
// job handle owns ALL descendants, even if they detach or the host is killed.
public sealed class WindowsServerHost : IDisposable
{
    IntPtr job, process, thread;
    public int Pid { get; private set; }

    static long Created(int pid) {
        using (var identity = Process.GetProcessById(pid))
            return (identity.StartTime.ToUniversalTime().Ticks - 621355968000000000) / 10000;
    }
    public static int Main(string[] args) {
        if (args.Length != 4) return 2;
        try {
            // Serialize ownership publication across concurrent starts. The OS
            // releases this exclusive lock even after abrupt host termination.
            using (var ownershipLock = new FileStream(Path.Combine(args[3], "windows-host.lock"),
                FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
            using (var server = new WindowsServerHost(args[0], "", args[1],
                Path.Combine(args[3], "launcher.stdout.log"), Path.Combine(args[3], "launcher.stderr.log"))) {
                int host = Process.GetCurrentProcess().Id;
                string ownership = "{\"pid\":" + server.Pid + ",\"created\":\"/Date(" + Created(server.Pid) +
                    ")/\",\"host\":{\"pid\":" + host + ",\"created\":\"/Date(" + Created(host) + ")/\"}}";
                // Publish before resume: even a partial startup is stoppable.
                File.WriteAllText(args[2] + ".part", ownership);
                File.Move(args[2] + ".part", args[2]);
                server.Resume();
                server.Wait();
            }
            return 0;
        } catch (Exception error) {
            // Node may still hold its append handle during startup failure.
            // Share writes and never turn a logging failure into a GUI crash dialog.
            try {
                using (var log = new StreamWriter(new FileStream(Path.Combine(args[3], "windows-host.log"),
                    FileMode.Append, FileAccess.Write, FileShare.ReadWrite))) log.WriteLine(error);
            } catch { }
            return 1;
        }
    }

    [StructLayout(LayoutKind.Sequential)] struct Security {
        public int Length; public IntPtr Descriptor; public int Inherit;
    }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] struct Startup {
        public int Size; public string Reserved, Desktop, Title;
        public int X, Y, XSize, YSize, XCount, YCount, Fill, Flags;
        public short Show, ReservedSize; public IntPtr ReservedBytes, Input, Output, Error;
    }
    [StructLayout(LayoutKind.Sequential)] struct ProcessData {
        public IntPtr Process, Thread; public int Pid, Tid;
    }
    [StructLayout(LayoutKind.Sequential)] struct BasicLimits {
        public long ProcessTime, JobTime; public uint Flags;
        public UIntPtr MinWorking, MaxWorking; public uint ActiveProcesses;
        public UIntPtr Affinity; public uint Priority, Scheduling;
    }
    [StructLayout(LayoutKind.Sequential)] struct IoCounters {
        public ulong ReadOps, WriteOps, OtherOps, ReadBytes, WriteBytes, OtherBytes;
    }
    [StructLayout(LayoutKind.Sequential)] struct ExtendedLimits {
        public BasicLimits Basic; public IoCounters Io;
        public UIntPtr ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory;
    }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateJobObject(IntPtr security, string name);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool SetInformationJobObject(IntPtr job, int type, ref ExtendedLimits limits, int size);
    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AssignProcessToJobObject(IntPtr job, IntPtr process);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool CreateProcess(string application, StringBuilder command, IntPtr processSecurity,
        IntPtr threadSecurity, bool inherit, uint flags, IntPtr environment, string directory,
        ref Startup startup, out ProcessData data);
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern IntPtr CreateFile(string path, uint access, uint share, ref Security security,
        uint disposition, uint flags, IntPtr template);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint ResumeThread(IntPtr thread);
    [DllImport("kernel32.dll", SetLastError = true)] static extern uint WaitForSingleObject(IntPtr handle, uint timeout);
    [DllImport("kernel32.dll", SetLastError = true)] static extern bool TerminateProcess(IntPtr process, uint code);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);

    static void Check(bool success) {
        if (!success) throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    static IntPtr OpenFile(string path, uint access, uint disposition) {
        var security = new Security { Length = Marshal.SizeOf(typeof(Security)), Inherit = 1 };
        IntPtr handle = CreateFile(path, access, 3, ref security, disposition, 0x80, IntPtr.Zero);
        if (handle == new IntPtr(-1)) throw new Win32Exception(Marshal.GetLastWin32Error());
        return handle;
    }

    public WindowsServerHost(string executable, string arguments, string directory, string stdout, string stderr) {
        IntPtr input = IntPtr.Zero, output = IntPtr.Zero, error = IntPtr.Zero;
        bool assigned = false;
        try {
            job = CreateJobObject(IntPtr.Zero, null); // Non-inheritable, unnamed.
            Check(job != IntPtr.Zero);
            var limits = new ExtendedLimits();
            limits.Basic.Flags = 0x2000; // JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE; no breakaway.
            Check(SetInformationJobObject(job, 9, ref limits, Marshal.SizeOf(typeof(ExtendedLimits))));
            input = OpenFile("NUL", 0x80000000, 3);
            output = OpenFile(stdout, 4, 4); // FILE_APPEND_DATA, OPEN_ALWAYS preserves existing logs.
            error = OpenFile(stderr, 4, 4);
            var startup = new Startup {
                Size = Marshal.SizeOf(typeof(Startup)), Flags = 0x101, Show = 0,
                Input = input, Output = output, Error = error
            }; // STARTF_USESHOWWINDOW | STARTF_USESTDHANDLES, SW_HIDE.
            ProcessData data;
            Check(CreateProcess(executable, new StringBuilder("\"" + executable + "\" " + arguments),
                IntPtr.Zero, IntPtr.Zero, true, 0x14, IntPtr.Zero, directory, ref startup, out data));
            // CREATE_NEW_CONSOLE | CREATE_SUSPENDED: assign ownership before any child can start.
            process = data.Process; thread = data.Thread; Pid = data.Pid;
            Check(AssignProcessToJobObject(job, process));
            assigned = true;
        } catch {
            if (!assigned && process != IntPtr.Zero) TerminateProcess(process, 1);
            Dispose();
            throw;
        } finally {
            if (input != IntPtr.Zero) CloseHandle(input);
            if (output != IntPtr.Zero) CloseHandle(output);
            if (error != IntPtr.Zero) CloseHandle(error);
        }
    }

    public void Resume() {
        if (ResumeThread(thread) == uint.MaxValue) throw new Win32Exception(Marshal.GetLastWin32Error());
        CloseHandle(thread); thread = IntPtr.Zero;
    }
    public void Wait() { Check(WaitForSingleObject(process, uint.MaxValue) == 0); }
    public void Dispose() {
        // Close the sole job handle first: kernel termination includes detached descendants.
        if (job != IntPtr.Zero) { CloseHandle(job); job = IntPtr.Zero; }
        if (thread != IntPtr.Zero) { CloseHandle(thread); thread = IntPtr.Zero; }
        if (process != IntPtr.Zero) { CloseHandle(process); process = IntPtr.Zero; }
    }
}
