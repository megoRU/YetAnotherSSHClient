package main.ssh;

import com.jediterm.core.util.TermSize;
import com.jediterm.terminal.TtyConnector;
import org.apache.sshd.common.channel.PtyMode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.channel.ChannelShell;
import org.apache.sshd.client.future.ConnectFuture;
import org.apache.sshd.client.session.ClientSession;
import org.apache.sshd.common.session.Session;
import org.apache.sshd.common.session.SessionListener;
import org.apache.sshd.common.util.security.SecurityUtils;
import org.jetbrains.annotations.NotNull;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyPair;
import java.util.HashMap;
import java.util.Map;

public class SshTtyConnector implements TtyConnector {

    private static final Logger LOGGER = LoggerFactory.getLogger(SshTtyConnector.class);
    private final SshClient sshClient;
    private final String name;
    private final String user;
    private final String host;
    private final int port;
    private final String password;
    private final String identityFile;

    private ClientSession session;
    private ChannelShell channel;
    private volatile OutputStream out;
    private volatile InputStreamReader reader;

    private volatile PipedOutputStream pos;
    private volatile InputStreamReader preReader;
    private volatile boolean connected = false;
    private Runnable onDisconnect;

    public SshTtyConnector(SshClient sshClient, String name, String user, String host, int port, String password, String identityFile) {
        this.sshClient = sshClient;
        this.name = name;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;
        initPreConnectionPipe();
    }

    public void initPreConnectionPipe() {
        this.pos = new PipedOutputStream();
        try {
            PipedInputStream pis = new PipedInputStream(pos);
            this.preReader = new InputStreamReader(pis, StandardCharsets.UTF_8);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
    }

    public void writeToTerminal(String msg) {
        try {
            if (pos != null) {
                pos.write(msg.getBytes(StandardCharsets.UTF_8));
                pos.flush();
            }
        } catch (IOException ignored) {
        }
    }

    public void closePreConnectionPipe() {
        try {
            if (pos != null) {
                pos.close();
                pos = null;
            }
        } catch (IOException ignored) {
        }
    }

    public void setOnDisconnect(Runnable onDisconnect) {
        this.onDisconnect = onDisconnect;
    }

    public void connect() {
        if (pos == null) {
            initPreConnectionPipe();
        }
        connected = false;
        try {
            if (channel != null) {
                try {
                    channel.close(true);
                } catch (Exception ignored) {
                }
            }
            if (session != null) {
                try {
                    session.close(true);
                } catch (Exception ignored) {
                }
            }
            ConnectFuture connectFuture = sshClient.connect(user, host, port).verify(10000);
            session = connectFuture.getSession();

            session.addSessionListener(new SessionListener() {
                @Override
                public void sessionClosed(Session session) {
                    if (connected) {
                        connected = false;
                        if (onDisconnect != null) {
                            onDisconnect.run();
                        }
                    }
                }
            });

            if (identityFile != null && !identityFile.isEmpty()) {
                Path path = Paths.get(identityFile);
                if (Files.exists(path)) {
                    try (InputStream is = Files.newInputStream(path)) {
                        Iterable<KeyPair> ids = SecurityUtils.loadKeyPairIdentities(session, null, is, null);
                        for (KeyPair kp : ids) {
                            session.addPublicKeyIdentity(kp);
                        }
                    }
                }
            }

            if (password != null && !password.isEmpty()) {
                session.addPasswordIdentity(password);
            }

            session.auth().verify(10000);

            channel = session.createShellChannel();
            channel.setPtyType("xterm-256color");

            Map<PtyMode, Integer> modes = new HashMap<>();
            modes.put(PtyMode.VINTR, 3);
            modes.put(PtyMode.VQUIT, 28);
            modes.put(PtyMode.VERASE, 127);
            modes.put(PtyMode.VKILL, 21);
            modes.put(PtyMode.VEOF, 4);
            modes.put(PtyMode.VEOL, 0);
            modes.put(PtyMode.VEOL2, 0);
            modes.put(PtyMode.VSTART, 17);
            modes.put(PtyMode.VSTOP, 19);
            modes.put(PtyMode.VSUSP, 26);
            modes.put(PtyMode.VREPRINT, 18);
            modes.put(PtyMode.VWERASE, 23);
            modes.put(PtyMode.VLNEXT, 22);
            modes.put(PtyMode.VDISCARD, 15);
            channel.setPtyModes(modes);

            channel.open().verify(10000);

            InputStream in = channel.getInvertedOut();
            this.out = channel.getInvertedIn();
            this.reader = new InputStreamReader(in, StandardCharsets.UTF_8);
            connected = true;
        } catch (Exception e) {
            LOGGER.error("SshTtyConnector connect failed", e);
            writeToTerminal("\r\n\033[31mОшибка подключения: " + e.getMessage() + "\033[0m\r\n");
        }
    }

    @Override
    public int read(char[] buf, int offset, int length) throws IOException {
        int n = preReader.read(buf, offset, length);
        if (n != -1) {
            return n;
        }
        if (connected && reader != null) {
            return reader.read(buf, offset, length);
        }
        return -1;
    }

    @Override
    public void write(byte[] bytes) throws IOException {
        OutputStream currentOut = out;
        if (currentOut != null) {
            currentOut.write(bytes);
            currentOut.flush();
        }
    }

    @Override
    public void write(String string) throws IOException {
        write(string.getBytes(StandardCharsets.UTF_8));
    }

    @Override
    public boolean isConnected() {
        return channel != null && channel.isOpen();
    }

    @Override
    public void resize(@NotNull TermSize termSize) {
        if (channel != null && channel.isOpen()) {
            try {
                channel.sendWindowChange(termSize.getColumns(), termSize.getRows());
            } catch (IOException e) {
                LOGGER.error("Error resizing channel", e);
            }
        }
    }

    @Override
    public int waitFor() {
        if (channel != null) {
            channel.waitFor(java.util.EnumSet.of(org.apache.sshd.client.channel.ClientChannelEvent.CLOSED), 0);
        }
        return 0;
    }

    @Override
    public boolean ready() throws IOException {
        return reader != null && reader.ready();
    }

    @Override
    public String getName() {
        return name;
    }

    @Override
    public void close() {
        connected = false;
        try {
            if (channel != null) channel.close(true);
            if (session != null) session.close(true);
        } catch (Exception e) {
            LOGGER.error("Error shutting down channel", e);
        }
    }
}
