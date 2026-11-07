// Jungle Leopard LCD bridge - core.
//
// SignalRGB can render LCD faces for the Jungle Leopard display, but its raw-USB layer only opens
// interface 0 of the device, while the display's data endpoints live on interface 1. The SignalRGB
// plugin therefore sends the finished, panel-ready byte stream over UDP to 127.0.0.1, and this
// bridge writes it to the display's normal COM port (the way the vendor app talks to it).
//
// Datagram from the plugin (little endian):
//   "JLB1" | type (1 = data) | message id u32 | chunk index u16 | chunk count u16 | payload
// A message is written to the serial port only once all of its chunks have arrived.
// Every second the bridge reports its state back to 127.0.0.1:StatusPort as ASCII text:
//   "JLB1 STATUS state=<connected|idle|noport|error> port=<COMx> msgs=<n> dropped=<n> version=<v>"
//
// Kept to C# 5 on purpose: Windows PowerShell 5.1 compiles it with Add-Type.

using System;
using System.Collections.Generic;
using System.IO;
using System.IO.Ports;
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Threading;
using Microsoft.Win32;

namespace JungleLeopard
{
	public interface IPanelPort
	{
		string Name { get; }
		void Open();
		void Close();
		void Write(byte[] data, int offset, int count);
	}

	/// <summary>The display's USB serial port: 115200 8N1, DTR and RTS asserted (as the vendor app does).</summary>
	public sealed class SerialPanelPort : IPanelPort
	{
		private readonly SerialPort port;

		public SerialPanelPort(string name)
		{
			port = new SerialPort(name, 115200, Parity.None, 8, StopBits.One);
			port.Handshake = Handshake.None;
			port.DtrEnable = true;
			port.RtsEnable = true;
			port.WriteTimeout = 3000;
			port.ReadTimeout = 500;
			port.WriteBufferSize = 256 * 1024;
		}

		public string Name { get { return port.PortName; } }

		public void Open()
		{
			port.Open();
			port.DiscardInBuffer();
		}

		public void Close()
		{
			try
			{
				if (port.IsOpen)
				{
					port.Close();
				}
			}
			catch (Exception)
			{
				// Closing a vanished port can throw; nothing left to release.
			}
		}

		public void Write(byte[] data, int offset, int count)
		{
			port.Write(data, offset, count);
		}
	}

	/// <summary>Reassembles chunked messages; keeps only a handful of incomplete ones.</summary>
	public sealed class MessageAssembler
	{
		public const int HeaderSize = 13;
		private const int MaxPending = 8;

		private sealed class Pending
		{
			public byte[][] Chunks;
			public int Received;
			public DateTime Started;
		}

		private readonly Dictionary<uint, Pending> pending = new Dictionary<uint, Pending>();

		public long Dropped { get; private set; }

		public static bool HasMagic(byte[] d, int length)
		{
			return length >= 4 && d[0] == 0x4A && d[1] == 0x4C && d[2] == 0x42 && d[3] == 0x31;
		}

		/// <summary>Returns the complete message once its last chunk arrives, otherwise null.</summary>
		public byte[] Add(byte[] d, int length, DateTime now)
		{
			if (length < HeaderSize || !HasMagic(d, length) || d[4] != 0x01)
			{
				Dropped++;
				return null;
			}

			uint id = (uint)(d[5] | (d[6] << 8) | (d[7] << 16) | (d[8] << 24));
			int index = d[9] | (d[10] << 8);
			int count = d[11] | (d[12] << 8);

			if (count == 0 || index >= count)
			{
				Dropped++;
				return null;
			}

			byte[] payload = new byte[length - HeaderSize];
			Buffer.BlockCopy(d, HeaderSize, payload, 0, payload.Length);

			if (count == 1)
			{
				return payload;
			}

			Pending p;

			if (!pending.TryGetValue(id, out p))
			{
				Expire(now);
				p = new Pending { Chunks = new byte[count][], Received = 0, Started = now };
				pending[id] = p;
			}

			if (p.Chunks.Length != count || p.Chunks[index] != null)
			{
				return null;
			}

			p.Chunks[index] = payload;
			p.Received++;

			if (p.Received < count)
			{
				return null;
			}

			pending.Remove(id);
			int total = 0;

			foreach (byte[] chunk in p.Chunks)
			{
				total += chunk.Length;
			}

			byte[] message = new byte[total];
			int offset = 0;

			foreach (byte[] chunk in p.Chunks)
			{
				Buffer.BlockCopy(chunk, 0, message, offset, chunk.Length);
				offset += chunk.Length;
			}

			return message;
		}

		private void Expire(DateTime now)
		{
			List<uint> stale = new List<uint>();

			foreach (KeyValuePair<uint, Pending> entry in pending)
			{
				if ((now - entry.Value.Started).TotalMilliseconds > 2000 || pending.Count - stale.Count >= MaxPending)
				{
					stale.Add(entry.Key);
				}
			}

			foreach (uint key in stale)
			{
				pending.Remove(key);
				Dropped++;
			}
		}
	}

	public sealed class Bridge
	{
		public const string Version = "1.0.0";
		public const int DefaultDataPort = 48960;
		public const int DefaultStatusPort = 48961;
		private const int IdleCloseMs = 5000;
		private const int PortRetryMs = 2000;

		public int DataPort = DefaultDataPort;
		public int StatusPort = DefaultStatusPort;

		/// <summary>Returns the display's port name, or null if it is not connected.</summary>
		public Func<string> PortFinder = FindPanelPort;
		public Func<string, IPanelPort> PortFactory = delegate (string name) { return new SerialPanelPort(name); };
		/// <summary>Fixed port name (e.g. "COM5") instead of the automatic search; empty = automatic.</summary>
		public string PortOverride;
		public string LogFile;

		private readonly MessageAssembler assembler = new MessageAssembler();
		private IPanelPort port;
		private UdpClient receiver;
		private UdpClient sender;
		private Thread worker;
		private volatile bool running;
		private volatile string state = "idle";
		private volatile string portName = "-";
		private volatile string lastError = "";
		private long messages;
		private DateTime lastMessage = DateTime.MinValue;
		private DateTime lastPortAttempt = DateTime.MinValue;
		private DateTime lastStatus = DateTime.MinValue;

		public string State { get { return state; } }
		public string PortName { get { return portName; } }
		public string LastError { get { return lastError; } }
		public long Messages { get { return Interlocked.Read(ref messages); } }
		public long Dropped { get { return assembler.Dropped; } }

		public string StatusText
		{
			get
			{
				switch (state)
				{
					case "connected": return "verbunden mit " + portName;
					case "noport": return "Display-COM-Port nicht gefunden";
					case "error": return "Fehler: " + lastError;
					default: return "bereit, wartet auf SignalRGB";
				}
			}
		}

		public void Start()
		{
			receiver = new UdpClient(new IPEndPoint(IPAddress.Loopback, DataPort));
			receiver.Client.ReceiveBufferSize = 8 * 1024 * 1024;
			receiver.Client.ReceiveTimeout = 500;
			sender = new UdpClient();
			running = true;
			worker = new Thread(Loop);
			worker.IsBackground = true;
			worker.Name = "JungleLeopardBridge";
			worker.Start();
			Log("Bridge " + Version + " listening on 127.0.0.1:" + DataPort + ", status to port " + StatusPort);
		}

		public void Stop()
		{
			running = false;

			try
			{
				receiver.Close();
			}
			catch (Exception)
			{
				// Already closed.
			}

			if (worker != null)
			{
				worker.Join(2000);
			}

			ClosePort("stopped");
			sender.Close();
		}

		private void Loop()
		{
			IPEndPoint remote = new IPEndPoint(IPAddress.Any, 0);

			while (running)
			{
				byte[] datagram = null;

				try
				{
					datagram = receiver.Receive(ref remote);
				}
				catch (SocketException)
				{
					// Receive timeout: fall through to housekeeping.
				}
				catch (ObjectDisposedException)
				{
					break;
				}

				DateTime now = DateTime.UtcNow;

				if (datagram != null)
				{
					byte[] message = assembler.Add(datagram, datagram.Length, now);

					if (message != null)
					{
						Deliver(message, now);
					}
				}

				Housekeeping(now);
			}
		}

		private void Deliver(byte[] message, DateTime now)
		{
			lastMessage = now;

			if (port == null && !TryOpenPort(now))
			{
				return;
			}

			try
			{
				port.Write(message, 0, message.Length);
				Interlocked.Increment(ref messages);
			}
			catch (Exception e)
			{
				lastError = e.Message;
				ClosePort("error");
				Log("Write to " + portName + " failed: " + e.Message);
			}
		}

		private bool TryOpenPort(DateTime now)
		{
			if ((now - lastPortAttempt).TotalMilliseconds < PortRetryMs)
			{
				return false;
			}

			lastPortAttempt = now;
			string name = null;

			try
			{
				name = string.IsNullOrEmpty(PortOverride) ? PortFinder() : PortOverride;
			}
			catch (Exception e)
			{
				lastError = e.Message;
			}

			if (string.IsNullOrEmpty(name))
			{
				if (state != "noport")
				{
					Log("Display COM port not found (USB VID_33C3&PID_7788).");
				}

				state = "noport";
				return false;
			}

			try
			{
				IPanelPort candidate = PortFactory(name);
				candidate.Open();
				port = candidate;
				portName = name;
				state = "connected";
				lastError = "";
				Log("Opened " + name + ".");
				return true;
			}
			catch (Exception e)
			{
				lastError = name + ": " + e.Message;
				state = "error";
				Log("Opening " + name + " failed: " + e.Message);
				return false;
			}
		}

		private void ClosePort(string newState)
		{
			if (port != null)
			{
				port.Close();
				port = null;
				Log("Closed " + portName + " (" + newState + ").");
			}

			state = newState;
		}

		private void Housekeeping(DateTime now)
		{
			// Let go of the port when SignalRGB stops sending, so the vendor app can use the display again.
			if (port != null && (now - lastMessage).TotalMilliseconds > IdleCloseMs)
			{
				ClosePort("idle");
			}

			if ((now - lastStatus).TotalMilliseconds >= 1000)
			{
				lastStatus = now;
				SendStatus();
			}
		}

		private void SendStatus()
		{
			string text = "JLB1 STATUS state=" + state + " port=" + portName + " msgs=" + Messages +
				" dropped=" + Dropped + " version=" + Version;
			byte[] data = Encoding.ASCII.GetBytes(text);

			try
			{
				sender.Send(data, data.Length, new IPEndPoint(IPAddress.Loopback, StatusPort));
			}
			catch (Exception)
			{
				// Nobody listening (SignalRGB not running): fine.
			}
		}

		public void Log(string message)
		{
			if (string.IsNullOrEmpty(LogFile))
			{
				return;
			}

			try
			{
				FileInfo info = new FileInfo(LogFile);

				if (info.Exists && info.Length > 1024 * 1024)
				{
					info.Delete();
				}

				File.AppendAllText(LogFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + "  " + message + Environment.NewLine);
			}
			catch (Exception)
			{
				// Logging must never stop the bridge.
			}
		}

		/// <summary>
		/// Finds the COM port of USB VID_33C3 PID_7788 in the registry (plain and composite variants) and checks
		/// that the port is currently present.
		/// </summary>
		public static string FindPanelPort()
		{
			string[] present = SerialPort.GetPortNames();

			try
			{
				using (RegistryKey usb = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Enum\USB"))
				{
					if (usb == null)
					{
						return null;
					}

					foreach (string device in usb.GetSubKeyNames())
					{
						if (!device.StartsWith("VID_33C3&PID_7788", StringComparison.OrdinalIgnoreCase))
						{
							continue;
						}

						using (RegistryKey deviceKey = usb.OpenSubKey(device))
						{
							foreach (string instance in deviceKey.GetSubKeyNames())
							{
								using (RegistryKey parameters = deviceKey.OpenSubKey(instance + @"\Device Parameters"))
								{
									string name = parameters == null ? null : parameters.GetValue("PortName") as string;

									if (!string.IsNullOrEmpty(name) && Array.IndexOf(present, name) >= 0)
									{
										return name;
									}
								}
							}
						}
					}
				}
			}
			catch (Exception)
			{
				// Registry not readable: no port.
			}

			return null;
		}
	}
}
