"""Exercise the packaged player using an isolated profile and native local IPC."""
import argparse
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import wave


def run(exe, video=None):
    exe = Path(exe).resolve(strict=True)
    if exe.with_name("unins000.exe").exists():
        raise ValueError("Use a portable/test executable, not an installed application")
    with tempfile.TemporaryDirectory(prefix="unison-smoke-") as directory:
        root = Path(directory).resolve()
        assert root.parent == Path(tempfile.gettempdir()).resolve()
        audio = root / "smoke.wav"
        with wave.open(str(audio), "wb") as output:
            output.setnchannels(1)
            output.setsampwidth(2)
            output.setframerate(8000)
            output.writeframes(b"\0" * (8000 * 2 * 90))
        env = os.environ.copy()
        media = Path(video).resolve(strict=True) if video else audio
        env.update(UNISON_PROFILE_DIR=str(root / "profile"), UNISON_RENDERER="gl" if video else "software", UNISON_AO="null")
        env.setdefault("UNISON_MPV_LOG", "1")
        env.setdefault("SLINT_SCALE_FACTOR", "1")  # Hosted Mac VMs render OpenGL on the CPU.
        env.pop("UNISON_MINI", None)
        env.pop("UNISON_RELAUNCHED", None)
        processes = []
        with open(root / "output.log", "w", encoding="utf-8") as log:
            try:
                def launch():
                    with socket.socket() as probe:
                        probe.bind(("127.0.0.1", 0))
                        port = probe.getsockname()[1]
                    env["UNISON_IPC_PORT"] = str(port)
                    endpoint = str(root / "ipc.sock")
                    env["UNISON_SOCKET"] = endpoint
                    process = subprocess.Popen([str(exe), str(media)], cwd=root, env=env, stdout=log, stderr=log)
                    processes.append(process)

                    def send(*parts):
                        stream = (socket.create_connection(("127.0.0.1", port), timeout=5)
                                  if os.name == "nt" else socket.socket(socket.AF_UNIX))
                        with stream:
                            if os.name != "nt":
                                stream.settimeout(5)
                                stream.connect(endpoint)
                            stream.sendall(("\t".join(parts) + "\n").encode())
                            return stream.recv(4096).decode("utf-8").strip()

                    def expect(value, format="{volume}|{muted}|{mini}"):
                        deadline = time.monotonic() + 20
                        while time.monotonic() < deadline:
                            if process.poll() is not None:
                                raise AssertionError(f"Player exited unexpectedly: {process.returncode}")
                            try:
                                result = send("status", format)
                                if result == value:
                                    return
                            except OSError:
                                pass
                            time.sleep(0.1)
                        raise AssertionError(f"Player did not reach expected state {value!r}")

                    def close():
                        try:
                            send("close")
                        except (ConnectionResetError, BrokenPipeError):
                            pass  # The process can exit before its final reply.
                        assert process.wait(timeout=10) == 0, "Player did not exit cleanly"
                        try:
                            probe = (socket.create_connection(("127.0.0.1", port), timeout=0.2)
                                     if os.name == "nt" else socket.socket(socket.AF_UNIX))
                            with probe:
                                if os.name != "nt":
                                    probe.settimeout(0.2)
                                    probe.connect(endpoint)
                                raise AssertionError("IPC listener survived closing the player")
                        except (ConnectionRefusedError, TimeoutError, FileNotFoundError):
                            pass

                    return send, expect, close

                send, expect, close = launch()
                expect("80|no|no")
                deadline = time.monotonic() + 30
                while time.monotonic() < deadline:
                    try:
                        status = send("status", "{pos}|{dur}").split("|")
                        if len(status) == 2 and all(value != "0:00" for value in status):
                            break
                    except OSError:
                        pass  # OpenGL initialization can temporarily occupy the UI thread.
                    time.sleep(0.2)
                else:
                    raise AssertionError("Media did not load and advance playback time")
                if video:
                    def advancing_frames():
                        before = None
                        deadline = time.monotonic() + 30
                        while time.monotonic() < deadline:
                            if processes[-1].poll() is not None:
                                raise AssertionError("Video player exited while rendering")
                            try:
                                frames = int(send("status", "{frames}"))
                                if before is None:
                                    before = frames
                                elif frames > before + 2:
                                    return
                            except (OSError, ValueError):
                                pass  # A slow virtual GPU must still eventually advance frames.
                            time.sleep(0.2)
                        raise AssertionError("Video frames stopped rendering")
                    advancing_frames()
                    send("fullscreen")
                    expect("yes", "{fullscreen}")
                    advancing_frames()
                    send("fullscreen")
                    expect("no", "{fullscreen}")
                    advancing_frames()
                send("mute")
                expect("80|yes|no")
                send("mini")
                expect("80|yes|yes")
                if video:
                    advancing_frames()
                send("mute")
                expect("80|no|yes")
                send("full")
                expect("80|no|no")
                if video:
                    advancing_frames()
                send("mute")
                expect("80|yes|no")
                close()
                send, expect, close = launch()
                expect("80|yes|no")  # Mute and volume survive a full process restart.
                close()
                print("PASS: native mute/restore, mini/full transitions, persisted mute, complete process exit and released IPC port")
                if video:
                    print("PASS: OpenGL frames advance in video, fullscreen, restored window and PiP")
            except Exception:
                log.flush()
                print((root / "output.log").read_text(encoding="utf-8", errors="replace"))
                if sys.platform == "darwin":
                    for process in processes:
                        if process.poll() is None:
                            sample = root / f"sample-{process.pid}.txt"
                            subprocess.run(["sample", str(process.pid), "2", "-file", str(sample)],
                                           capture_output=True, timeout=15)
                            if sample.exists():
                                print(sample.read_text(errors="replace")[:24000])
                raise
            finally:
                for process in processes:
                    if process.poll() is None:
                        process.terminate()  # Only children created here, with isolated data.
                        process.wait(timeout=10)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--exe", required=True)
    parser.add_argument("--video", help="Also verify real OpenGL frames, fullscreen and PiP using this video")
    args = parser.parse_args()
    run(args.exe, args.video)
