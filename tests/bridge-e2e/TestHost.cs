// Test host for the bridge core (bridge/JungleLeopardBridge.cs), used by tests/bridge.e2e.test.mjs.
// Runs the real bridge, but writes to a given file/pty path instead of looking up a Windows COM port.
//   mono TestHost.exe <panel-path> <data-port> <status-port> [log-file] [serial]
using System;
using System.IO;
using JungleLeopard;

public sealed class FilePort : IPanelPort
{
	private readonly string path;
	private FileStream stream;

	public FilePort(string path)
	{
		this.path = path;
	}

	public string Name { get { return path; } }

	public void Open()
	{
		stream = new FileStream(path, FileMode.Open, FileAccess.Write);
	}

	public void Close()
	{
		if (stream != null)
		{
			stream.Close();
			stream = null;
		}
	}

	public void Write(byte[] data, int offset, int count)
	{
		stream.Write(data, offset, count);
		stream.Flush();
	}
}

public static class TestHost
{
	public static int Main(string[] args)
	{
		string path = args[0];
		Bridge bridge = new Bridge();
		bridge.DataPort = int.Parse(args[1]);
		bridge.StatusPort = int.Parse(args[2]);
		bridge.LogFile = args.Length > 3 ? args[3] : null;
		bridge.PortFinder = delegate { return path; };

		if (args.Length <= 4 || args[4] != "serial")
		{
			bridge.PortFactory = delegate (string name) { return new FilePort(name); };
		}

		bridge.Start();
		Console.WriteLine("READY");
		Console.Out.Flush();
		Console.In.ReadToEnd();
		bridge.Stop();

		return 0;
	}
}
