package org.mego.ssh;

import com.jediterm.core.util.TermSize;
import com.jediterm.terminal.TtyConnector;
import lombok.extern.slf4j.Slf4j;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.channel.ChannelShell;
import org.apache.sshd.client.future.ConnectFuture;
import org.apache.sshd.client.session.ClientSession;
import org.apache.sshd.common.util.security.SecurityUtils;
import org.jetbrains.annotations.NotNull;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.security.KeyPair;

@Slf4j
public class SshTtyConnector implements TtyConnector {

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

    public SshTtyConnector(SshClient sshClient, String user, String host, int port, String password, String identityFile) {
        this.sshClient = sshClient;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;
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
            return true;
        } catch (Exception e) {
            log.error("SshTtyConnector connect failed", e);
            return false;
        }
    }

    @Override
    public int read(char[] buf, int offset, int length) throws IOException {
        return reader.read(buf, offset, length);
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
                log.error("Error resizing channel", e);
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
            log.error("Error shutting down channel", e);
        }
    }
}
