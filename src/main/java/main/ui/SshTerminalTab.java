package main.ui;

import com.jediterm.terminal.HyperlinkStyle;
import com.jediterm.terminal.TerminalColor;
import com.jediterm.terminal.TextStyle;
import com.jediterm.terminal.emulator.ColorPalette;
import com.jediterm.terminal.emulator.ColorPaletteImpl;
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
    private final String name;
    private final String user;
    private final String host;
    private final String port;
    private final String password;
    private final String identityFile;
    private final AtomicBoolean connecting = new AtomicBoolean(false);
    private final JPanel reconnectPanel;

    public SshTerminalTab(SshClient sshClient, ConfigManager configManager, String name, String user, String host, String port, String password, String identityFile) {
        this.configManager = configManager;
        this.name = name;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;

        this.connector = new SshTtyConnector(sshClient, name, user, host, Integer.parseInt(port), password, identityFile);

        setLayout(new BorderLayout());

        reconnectPanel = new JPanel(new FlowLayout(FlowLayout.CENTER));
        this.connector.setOnDisconnect(() -> SwingUtilities.invokeLater(() -> reconnectPanel.setVisible(true)));
        reconnectPanel.setBackground(new Color(200, 50, 50));
        JButton reconnectBtn = new JButton("Соединение разорвано. Переподключиться?");
        reconnectBtn.addActionListener(e -> connect());
        reconnectPanel.add(reconnectBtn);
        reconnectPanel.setVisible(false);
        add(reconnectPanel, BorderLayout.NORTH);

        terminalWidget = new JediTermWidget(new DefaultSettingsProvider() {
            @Override
            public ColorPalette getTerminalColorPalette() {
                return new ColorPalette() {
                    @Override
                    protected com.jediterm.core.Color getForegroundByColorIndex(int i) {
                        return dim(ColorPaletteImpl.XTERM_PALETTE.getForeground(new TerminalColor(i)));
                    }

                    @Override
                    protected com.jediterm.core.Color getBackgroundByColorIndex(int i) {
                        return dim(ColorPaletteImpl.XTERM_PALETTE.getBackground(new TerminalColor(i)));
                    }

                    private com.jediterm.core.Color dim(com.jediterm.core.Color c) {
                        // Немного приглушаем цвета, делая их менее насыщенными и яркими
                        int r = c.getRed();
                        int g = c.getGreen();
                        int b = c.getBlue();

                        // Если это чисто яркий цвет (например, ярко-зеленый 0,255,0),
                        // мы его смягчаем
                        if (r == 0 && g == 255 && b == 0) {
                            return new com.jediterm.core.Color(100, 200, 100);
                        }

                        return new com.jediterm.core.Color(
                                (int)(r * 0.8 + 30),
                                (int)(g * 0.8 + 30),
                                (int)(b * 0.8 + 30)
                        );
                    }
                };
            }

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
            public TextStyle getSelectionColor() {
                return new TextStyle(new TerminalColor(255, 255, 255), new TerminalColor(128, 128, 128));
            }

            @Override
            public boolean useInverseSelectionColor() {
                return false;
            }

            @Override
            public boolean enableMouseReporting() {
                return true;
            }

            @Override
            public boolean forceActionOnMouseReporting() {
                return false;
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

            @Override
            public TextStyle getHyperlinkColor() {
                return new TextStyle(new TerminalColor(80, 200, 255), null);
            }

            @Override
            public HyperlinkStyle.HighlightMode getHyperlinkHighlightingMode() {
                return HyperlinkStyle.HighlightMode.ALWAYS;
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
        terminalWidget.addHyperlinkFilter(new KeywordHighlighter());
        add(terminalWidget, BorderLayout.CENTER);
        terminalWidget.start();
    }

    public void connect() {
        if (connecting.compareAndSet(false, true)) {
            reconnectPanel.setVisible(false);
            new Thread(() -> {
                Thread animationThread = new Thread(this::runConnectionAnimation);
                animationThread.start();
                try {
                    connector.connect();
                    if (connector.isConnected()) {
                        SwingUtilities.invokeLater(terminalWidget::start);
                    }
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
        if ("Gruvbox Light".equals(theme)) {
            return new Color(251, 241, 199);
        }
        return new Color(43, 43, 43);
    }

    private Color getThemeForeground() {
        String theme = configManager.getTheme();
        if ("Светлый".equals(theme) || "Light".equals(theme)) {
            return Color.BLACK;
        }
        if ("Gruvbox Light".equals(theme)) {
            return new Color(60, 56, 54);
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
