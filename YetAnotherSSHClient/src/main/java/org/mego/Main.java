package org.mego;

import com.jediterm.core.util.TermSize;
import com.jediterm.terminal.TtyConnector;
import com.jediterm.terminal.ui.JediTermWidget;
import com.jediterm.terminal.ui.TerminalAction;
import com.jediterm.terminal.ui.settings.DefaultSettingsProvider;
import com.pty4j.PtyProcess;
import com.pty4j.WinSize;

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
import java.util.List;
import java.util.Properties;

public class Main {

    private static final String CONFIG_FILE = System.getProperty("user.home") + File.separator + ".minissh_config.properties";
    private static final String FAVORITES_FILE = System.getProperty("user.home") + File.separator + ".minissh_favorites.txt";

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

        final String[] currentConn = new String[3]; // user, host, port

        Runnable updateFavorites = () -> {
            favoritesSubMenu.removeAll();
            List<String> favorites = loadFavorites();
            for (String fav : favorites) {
                String[] parts = fav.split(",", 4);
                if (parts.length == 4) {
                    JMenuItem item = new JMenuItem(parts[0] + " (" + parts[1] + "@" + parts[2] + ":" + parts[3] + ")");
                    item.addActionListener(e -> {
                        currentConn[0] = parts[1];
                        currentConn[1] = parts[2];
                        currentConn[2] = parts[3];
                        startSshProcess(terminalWidget, parts[1], parts[2], parts[3]);
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
            String user = JOptionPane.showInputDialog(frame, "Имя пользователя:", "root");
            String port = JOptionPane.showInputDialog(frame, "Порт:", "12222");
            if (host != null && user != null && port != null && !host.isEmpty() && !user.isEmpty() && !port.isEmpty()) {
                currentConn[0] = user;
                currentConn[1] = host;
                currentConn[2] = port;
                startSshProcess(terminalWidget, user, host, port);
            }
        });

        addFavoriteItem.addActionListener(e -> {
            if (currentConn[1] == null) {
                JOptionPane.showMessageDialog(frame, "Нет активного подключения для добавления в избранное.");
                return;
            }
            String name = JOptionPane.showInputDialog(frame, "Название избранного:", currentConn[1]);
            if (name != null && !name.isEmpty()) {
                saveFavorite(name.replace(",", " "), currentConn[0], currentConn[1], currentConn[2]);
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
            }
        });

        frame.setVisible(true);
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

    private static void saveFavorite(String name, String user, String host, String port) {
        try {
            String entry = String.format("%s,%s,%s,%s", name, user, host, port);
            Files.write(Paths.get(FAVORITES_FILE), (entry + System.lineSeparator()).getBytes(StandardCharsets.UTF_8),
                    StandardOpenOption.CREATE, StandardOpenOption.APPEND);
        } catch (IOException e) {
            e.printStackTrace();
        }
    }

    private static void startSshProcess(JediTermWidget terminalWidget, String user, String host, String port) {
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add("ssh");
            cmd.add("-o");
            cmd.add("StrictHostKeyChecking=no");
            cmd.add("-p");
            cmd.add(port);
            cmd.add(user + "@" + host);

            PtyProcess pty = PtyProcess.exec(cmd.toArray(new String[0]), null, String.valueOf(new File(".")));

            if (terminalWidget.getTtyConnector() != null) {
                terminalWidget.getTtyConnector().close();
            }

            terminalWidget.setTtyConnector(new PtyTtyConnector(pty));
            terminalWidget.start();

        } catch (IOException e) {
            e.printStackTrace();
            JOptionPane.showMessageDialog(null, "Ошибка запуска SSH: " + e.getMessage());
        }
    }

    private static class PtyTtyConnector implements TtyConnector {
        private final PtyProcess pty;
        private final InputStream in;
        private final OutputStream out;
        private final InputStreamReader reader;

        public PtyTtyConnector(PtyProcess pty) {
            this.pty = pty;
            this.in = pty.getInputStream();
            this.out = pty.getOutputStream();
            this.reader = new InputStreamReader(in, StandardCharsets.UTF_8);
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
            return pty.isAlive();
        }

        @Override
        public void resize(TermSize termSize) {
            pty.setWinSize(new WinSize(termSize.getColumns(), termSize.getRows()));
        }

        @Override
        public int waitFor() throws InterruptedException {
            return pty.waitFor();
        }

        @Override
        public boolean ready() throws IOException {
            return reader.ready();
        }

        @Override
        public String getName() {
            return "SSH";
        }

        @Override
        public void close() {
            pty.destroy();
        }
    }
}
