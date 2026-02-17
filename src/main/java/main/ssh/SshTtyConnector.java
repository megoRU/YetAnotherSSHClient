package main.ssh;

import com.jediterm.core.util.TermSize;
import com.jediterm.terminal.TtyConnector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.channel.ChannelShell;
import org.apache.sshd.client.future.ConnectFuture;
import org.apache.sshd.client.session.ClientSession;
import org.apache.sshd.common.util.security.SecurityUtils;
import org.jetbrains.annotations.NotNull;

import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyPair;

public class SshTtyConnector implements TtyConnector {

    private static final Logger LOGGER = LoggerFactory.getLogger(SshTtyConnector.class);
    private final SshClient sshClient;
    private final String user;
    private final String host;
    private final int port;
    private final String password;
    private final String identityFile;

    private ClientSession session;
    private ChannelShell channel;
    private OutputStream out;
    private InputStreamReader reader;

    private final PipedOutputStream pos;
    private final PipedInputStream pis;
    private final InputStreamReader preReader;
    private volatile boolean connected = false;

    public SshTtyConnector(SshClient sshClient, String user, String host, int port, String password, String identityFile) {
        this.sshClient = sshClient;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;

        this.pos = new PipedOutputStream();
        try {
            this.pis = new PipedInputStream(pos);
        } catch (IOException e) {
            throw new RuntimeException(e);
        }
        this.preReader = new InputStreamReader(pis, StandardCharsets.UTF_8);
    }

    public void writeToTerminal(String msg) {
        try {
            pos.write(msg.getBytes(StandardCharsets.UTF_8));
            pos.flush();
        } catch (IOException ignored) {
        }
    }

    public void closePreConnectionPipe() {
        try {
            pos.close();
        } catch (IOException ignored) {
        }
    }

    public boolean connect() {
        try {
            ConnectFuture connectFuture = sshClient.connect(user, host, port).verify(10000);
            session = connectFuture.getSession();

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
            channel.open().verify(10000);

            InputStream in = channel.getInvertedOut();
            this.out = channel.getInvertedIn();
            this.reader = new InputStreamReader(in, StandardCharsets.UTF_8);
            connected = true;
            return true;
        } catch (Exception e) {
            LOGGER.error("SshTtyConnector connect failed", e);
            writeToTerminal("\r\n\033[31mОшибка подключения: " + e.getMessage() + "\033[0m\r\n");
            return false;
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
        out.write(bytes);
        out.flush();
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
        return user + "@" + host;
    }

    @Override
    public void close() {
        try {
            if (channel != null) channel.close();
            if (session != null) session.close();
        } catch (IOException e) {
            LOGGER.error("Error shutting down channel", e);
        }
    }
}
