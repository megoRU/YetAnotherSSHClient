package org.mego;

import com.jediterm.core.util.TermSize;
import com.jediterm.terminal.TtyConnector;
import com.jediterm.terminal.ui.JediTermWidget;
import com.jediterm.terminal.ui.TerminalAction;
import com.jediterm.terminal.ui.settings.DefaultSettingsProvider;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.channel.ChannelShell;
import org.apache.sshd.client.future.ConnectFuture;
import org.apache.sshd.client.keyverifier.AcceptAllServerKeyVerifier;
import org.apache.sshd.client.session.ClientSession;

import javax.swing.*;
import java.awt.*;
import java.awt.event.InputEvent;
import java.awt.event.KeyEvent;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Paths;
import java.nio.file.StandardOpenOption;
import java.util.ArrayList;
import java.util.Base64;
import java.util.List;
import java.util.Properties;

public class Main {

    private static final String CONFIG_FILE = System.getProperty("user.home") + File.separator + ".minissh_config.properties";
    private static final String FAVORITES_FILE = System.getProperty("user.home") + File.separator + ".minissh_favorites.txt";

    private static SshClient sshClient;

    static {
        sshClient = SshClient.setUpDefaultClient();
        sshClient.setServerKeyVerifier(AcceptAllServerKeyVerifier.INSTANCE);
        sshClient.start();
    }

    public static void main(String[] args) {
        SwingUtilities.invokeLater(Main::createAndShowGui);
    }

    private static void createAndShowGui() {
        JFrame frame = new JFrame("Мини SSH клиент");
        frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);

        restoreWindowPosition(frame);

        JediTermWidget terminalWidget = new JediTermWidget(new DefaultSettingsProvider());
        frame.add(terminalWidget, BorderLayout.CENTER);

        // Menu bar
        JMenuBar menuBar = new JMenuBar();

        // Servers Menu
        JMenu serversMenu = new JMenu("Серверы");
        JMenuItem newConnItem = new JMenuItem("Новое подключение");
        JMenuItem addFavoriteItem = new JMenuItem("Добавить в избранное");
        JMenu favoritesSubMenu = new JMenu("Избранное");
        serversMenu.add(newConnItem);
        serversMenu.add(addFavoriteItem);
        serversMenu.add(favoritesSubMenu);

        // Edit Menu
        JMenu editMenu = new JMenu("Правка");
        JMenuItem copyItem = new JMenuItem("Копировать");
        copyItem.setAccelerator(KeyStroke.getKeyStroke(KeyEvent.VK_C, InputEvent.CTRL_DOWN_MASK | InputEvent.SHIFT_DOWN_MASK));
        JMenuItem pasteItem = new JMenuItem("Вставить");
        pasteItem.setAccelerator(KeyStroke.getKeyStroke(KeyEvent.VK_V, InputEvent.CTRL_DOWN_MASK | InputEvent.SHIFT_DOWN_MASK));
        editMenu.add(copyItem);
        editMenu.add(pasteItem);

        menuBar.add(serversMenu);
        menuBar.add(editMenu);
        frame.setJMenuBar(menuBar);

        // Link Edit actions
        for (TerminalAction action : terminalWidget.getActions()) {
            String name = action.getName().toLowerCase();
            if (name.contains("copy")) {
                copyItem.addActionListener(e -> action.actionPerformed(null));
            } else if (name.contains("paste")) {
                pasteItem.addActionListener(e -> action.actionPerformed(null));
            }
        }

        final String[] currentConn = new String[4]; // user, host, port, password

        Runnable updateFavorites = () -> {
            favoritesSubMenu.removeAll();
            List<String> favorites = loadFavorites();
            for (String fav : favorites) {
                String[] parts = fav.split("\t", 5);
                if (parts.length >= 4) {
                    String name = parts[0];
                    String user = parts[1];
                    String host = parts[2];
                    String port = parts[3];
                    String password = parts.length == 5 ? decrypt(parts[4]) : "";

                    JMenuItem item = new JMenuItem(name + " (" + user + "@" + host + ":" + port + ")");
                    item.addActionListener(e -> {
                        currentConn[0] = user;
                        currentConn[1] = host;
                        currentConn[2] = port;
                        currentConn[3] = password;
                        startSshProcess(terminalWidget, user, host, port, password);
                    });
                    favoritesSubMenu.add(item);
                }
            }
            favoritesSubMenu.revalidate();
            frame.repaint();
        };

        updateFavorites.run();

        newConnItem.addActionListener(e -> {
            String host = JOptionPane.showInputDialog(frame, "Хост:", "77.110.97.210");
            if (host == null || host.isEmpty()) return;
            String user = JOptionPane.showInputDialog(frame, "Имя пользователя:", "root");
            if (user == null || user.isEmpty()) return;
            String port = JOptionPane.showInputDialog(frame, "Порт:", "12222");
            if (port == null || port.isEmpty()) return;
            String password = showPasswordDialog(frame, "Пароль (опционально):");

            currentConn[0] = user;
            currentConn[1] = host;
            currentConn[2] = port;
            currentConn[3] = password;
            startSshProcess(terminalWidget, user, host, port, password);
        });

        addFavoriteItem.addActionListener(e -> {
            if (currentConn[1] == null) {
                JOptionPane.showMessageDialog(frame, "Нет активного подключения для добавления в избранное.");
                return;
            }
            String name = JOptionPane.showInputDialog(frame, "Название избранного:", currentConn[1]);
            if (name != null && !name.isEmpty()) {
                saveFavorite(name, currentConn[0], currentConn[1], currentConn[2], currentConn[3]);
                updateFavorites.run();
            }
        });

        frame.addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent e) {
                saveWindowPosition(frame);
                if (terminalWidget.getTtyConnector() != null) {
                    terminalWidget.getTtyConnector().close();
                }
                try {
                    sshClient.stop();
                } catch (Exception ex) {
                    // ignore
                }
            }
        });

        frame.setVisible(true);
    }

    private static String encrypt(String s) {
        if (s == null) return "";
        return Base64.getEncoder().encodeToString(s.getBytes(StandardCharsets.UTF_8));
    }

    private static String decrypt(String s) {
        if (s == null || s.isEmpty()) return "";
        try {
            return new String(Base64.getDecoder().decode(s), StandardCharsets.UTF_8);
        } catch (Exception e) {
            return s;
        }
    }

    private static String showPasswordDialog(Component parent, String title) {
        JPasswordField pf = new JPasswordField();
        int okCxl = JOptionPane.showConfirmDialog(parent, pf, title, JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE);
        if (okCxl == JOptionPane.OK_OPTION) {
            return new String(pf.getPassword());
        }
        return null;
    }

    private static void saveWindowPosition(JFrame frame) {
        Properties props = new Properties();
        props.setProperty("x", String.valueOf(frame.getX()));
        props.setProperty("y", String.valueOf(frame.getY()));
        props.setProperty("width", String.valueOf(frame.getWidth()));
        props.setProperty("height", String.valueOf(frame.getHeight()));
        try (OutputStream out = new FileOutputStream(CONFIG_FILE)) {
            props.store(out, "Window Position");
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private static void restoreWindowPosition(JFrame frame) {
        Properties props = new Properties();
        if (Files.exists(Paths.get(CONFIG_FILE))) {
            try (InputStream in = new FileInputStream(CONFIG_FILE)) {
                props.load(in);
                int x = Integer.parseInt(props.getProperty("x", "100"));
                int y = Integer.parseInt(props.getProperty("y", "100"));
                int width = Integer.parseInt(props.getProperty("width", "1000"));
                int height = Integer.parseInt(props.getProperty("height", "700"));
                frame.setBounds(x, y, width, height);
                return;
            } catch (IOException | NumberFormatException e) {
                // ignore
            }
        }
        frame.setSize(1000, 700);
        frame.setLocationRelativeTo(null);
    }

    private static List<String> loadFavorites() {
        try {
            if (Files.exists(Paths.get(FAVORITES_FILE))) {
                return Files.readAllLines(Paths.get(FAVORITES_FILE));
            }
        } catch (IOException e) {
            e.printStackTrace();
        }
        return new ArrayList<>();
    }

    private static void saveFavorite(String name, String user, String host, String port, String password) {
        try {
            String entry = String.format("%s\t%s\t%s\t%s\t%s", name, user, host, port, encrypt(password));
            Files.write(Paths.get(FAVORITES_FILE), (entry + System.lineSeparator()).getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private static void startSshProcess(JediTermWidget terminalWidget, String user, String host, String port, String password) {
        if (terminalWidget.getTtyConnector() != null) {
            terminalWidget.getTtyConnector().close();
        }

        new Thread(() -> {
            try {
                SshTtyConnector connector = new SshTtyConnector(user, host, Integer.parseInt(port), password);
                if (connector.connect()) {
                    SwingUtilities.invokeLater(() -> {
                        terminalWidget.setTtyConnector(connector);
                        terminalWidget.start();
                    });
                } else {
                    SwingUtilities.invokeLater(() -> {
                        JOptionPane.showMessageDialog(null, "Не удалось подключиться к серверу: " + host);
                    });
                }
            } catch (Exception e) {
                e.printStackTrace();
                SwingUtilities.invokeLater(() -> {
                    JOptionPane.showMessageDialog(null, "Ошибка: " + e.getMessage());
                });
            }
        }).start();
    }

    private static class SshTtyConnector implements TtyConnector {
        private final String user;
        private final String host;
        private final int port;
        private final String password;

        private ClientSession session;
        private ChannelShell channel;
        private InputStream in;
        private OutputStream out;
        private InputStreamReader reader;

        public SshTtyConnector(String user, String host, int port, String password) {
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
            return "SSH";
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
}
