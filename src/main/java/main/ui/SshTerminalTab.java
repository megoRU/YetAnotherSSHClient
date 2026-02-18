package main.ui;

import com.jediterm.terminal.TerminalColor;
import com.jediterm.terminal.ui.JediTermWidget;
import com.jediterm.terminal.ui.settings.DefaultSettingsProvider;
import main.config.ConfigManager;
import main.ssh.SshTtyConnector;
import org.apache.sshd.client.SshClient;
import org.jetbrains.annotations.NotNull;

import javax.swing.*;
import java.awt.*;
import java.util.concurrent.atomic.AtomicBoolean;

public class SshTerminalTab extends JPanel {

    private final JediTermWidget terminalWidget;
    private final SshTtyConnector connector;
    private final ConfigManager configManager;

    // Connection info for favorites
    private final String user;
    private final String host;
    private final String port;
    private final String password;
    private final String identityFile;
    private final AtomicBoolean connecting = new AtomicBoolean(false);

    public SshTerminalTab(SshClient sshClient, ConfigManager configManager, String user, String host, String port, String password, String identityFile) {
        this.configManager = configManager;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;

        this.connector = new SshTtyConnector(sshClient, user, host, Integer.parseInt(port), password, identityFile);

        setLayout(new BorderLayout());

        terminalWidget = new JediTermWidget(new DefaultSettingsProvider() {
            @Override
            public Font getTerminalFont() {
                return configManager.getTerminalFont();
            }

            @Override
            public float getTerminalFontSize() {
                return configManager.getTerminalFontSize();
            }

            @Override
            public @NotNull TerminalColor getDefaultForeground() {
                Color c = getThemeForeground();
                return new TerminalColor(c.getRed(), c.getGreen(), c.getBlue());
            }

            @Override
            public @NotNull TerminalColor getDefaultBackground() {
                Color c = getThemeBackground();
                return new TerminalColor(c.getRed(), c.getGreen(), c.getBlue());
            }

            @Override
            public boolean enableMouseReporting() {
                return true;
            }

            @Override
            public boolean copyOnSelect() {
                return false;
            }

            @Override
            public boolean ambiguousCharsAreDoubleWidth() {
                return false;
            }

            @Override
            public boolean useAntialiasing() {
                return true;
            }
        }) {
            @Override
            protected JScrollBar createScrollBar() {
                JScrollBar bar = super.createScrollBar();
                bar.setUnitIncrement(16);
                return bar;
            }
        };

        terminalWidget.setTtyConnector(connector);
        terminalWidget.setBackground(getThemeBackground());
        terminalWidget.setForeground(getThemeForeground());
        add(terminalWidget, BorderLayout.CENTER);
        terminalWidget.start();
    }

    public void connect() {
        if (connecting.compareAndSet(false, true)) {
            new Thread(() -> {
                Thread animationThread = new Thread(this::runConnectionAnimation);
                animationThread.start();
                try {
                    connector.connect();
                } finally {
                    connecting.set(false);
                    animationThread.interrupt();
                    try {
                        animationThread.join();
                    } catch (InterruptedException ignored) {
                    }
                    connector.closePreConnectionPipe();
                }
            }).start();
        }
    }

    private void runConnectionAnimation() {
        String[] spinner = {"|", "/", "-", "\\"};
        int i = 0;
        try {
            while (connecting.get()) {
                String msg = "\r\033[36mПодключение к " + host + "... " + spinner[i % spinner.length] + "\033[0m";
                connector.writeToTerminal(msg);
                i++;
                Thread.sleep(100);
            }
        } catch (InterruptedException ignored) {
        }
        // Очистить строку подключения после завершения (или оставить если ошибка, но connector.connect сам выведет ошибку)
        connector.writeToTerminal("\r\033[K"); // \033[K - clear line from cursor to end
    }

    private Color getThemeBackground() {
        String theme = configManager.getTheme();
        if ("Светлый".equals(theme) || "Light".equals(theme)) {
            return Color.WHITE;
        }
        return new Color(43, 43, 43);
    }

    private Color getThemeForeground() {
        String theme = configManager.getTheme();
        if ("Светлый".equals(theme) || "Light".equals(theme)) {
            return Color.BLACK;
        }
        return Color.WHITE;
    }

    public void updateSettings() {
        terminalWidget.setFont(configManager.getTerminalFont());
        terminalWidget.setBackground(getThemeBackground());
        terminalWidget.setForeground(getThemeForeground());
        terminalWidget.revalidate();
        terminalWidget.repaint();
    }

    public void close() {
        terminalWidget.close();
        if (connector != null) {
            connector.close();
        }
    }

    public String getTitle() {
        return connector.getName();
    }

    @Override
    public boolean requestFocusInWindow() {
        return terminalWidget.requestFocusInWindow();
    }

    public String getUser() {
        return user;
    }

    public String getHost() {
        return host;
    }

    public String getPort() {
        return port;
    }

    public String getPassword() {
        return password;
    }

    public String getIdentityFile() {
        return identityFile;
    }
}
