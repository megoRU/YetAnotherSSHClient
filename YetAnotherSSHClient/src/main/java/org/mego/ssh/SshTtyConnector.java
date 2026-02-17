package org.mego.ssh;

import com.jediterm.core.util.TermSize;
import com.jediterm.terminal.TtyConnector;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.channel.ChannelShell;
import org.apache.sshd.client.future.ConnectFuture;
import org.apache.sshd.client.session.ClientSession;

import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

public class SshTtyConnector implements TtyConnector {
    private final SshClient sshClient;
    private final String user;
    private final String host;
    private final int port;
    private final String password;

    private ClientSession session;
    private ChannelShell channel;
    private InputStream in;
    private OutputStream out;
    private InputStreamReader reader;

    public SshTtyConnector(SshClient sshClient, String user, String host, int port, String password) {
        this.sshClient = sshClient;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
    }

    public boolean connect() {
        try {
            ConnectFuture connectFuture = sshClient.connect(user, host, port).verify(10000);
            session = connectFuture.getSession();
            if (password != null && !password.isEmpty()) {
                session.addPasswordIdentity(password);
            }
            session.auth().verify(10000);

            channel = session.createShellChannel();
            channel.open().verify(10000);

            this.in = channel.getInvertedOut();
            this.out = channel.getInvertedIn();
            this.reader = new InputStreamReader(in, StandardCharsets.UTF_8);
            return true;
        } catch (Exception e) {
            e.printStackTrace();
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
    public void resize(TermSize termSize) {
        if (channel != null && channel.isOpen()) {
            try {
                channel.sendWindowChange(termSize.getColumns(), termSize.getRows());
            } catch (IOException e) {
                e.printStackTrace();
            }
        }
    }

    @Override
    public int waitFor() throws InterruptedException {
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
            e.printStackTrace();
        }
    }
}
