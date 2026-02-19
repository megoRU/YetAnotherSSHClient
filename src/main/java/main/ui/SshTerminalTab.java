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
import java.util.EnumSet;
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
        setBackground(getThemeBackground());
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
                        if (i == 2 || i == 10) return new com.jediterm.core.Color(176, 151, 26); // b0971a (service)
                        if (i == 5 || i == 13) return new com.jediterm.core.Color(209, 131, 169); // d183a9 (port)
                        if (i == 6 || i == 14) return new com.jediterm.core.Color(66, 141, 153); // 428d99 (CPU/Mem in htop)
                        return dim(ColorPaletteImpl.XTERM_PALETTE.getForeground(new TerminalColor(i)));
                    }

                    @Override
                    protected com.jediterm.core.Color getBackgroundByColorIndex(int i) {
                        return dim(ColorPaletteImpl.XTERM_PALETTE.getBackground(new TerminalColor(i)));
                    }

                    private com.jediterm.core.Color dim(com.jediterm.core.Color c) {
                        int r = c.getRed();
                        int g = c.getGreen();
                        int b = c.getBlue();

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
                // Цвет d2549a для IP и ключевых слов, без подчеркивания
                return new TextStyle(new TerminalColor(210, 84, 154), null, EnumSet.noneOf(TextStyle.Option.class));
            }

            @Override
            public HyperlinkStyle.HighlightMode getHyperlinkHighlightingMode() {
                return HyperlinkStyle.HighlightMode.HOVER;
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
                        SwingUtilities.invokeLater(() -> {
                            terminalWidget.stop();
                            terminalWidget.start();
                        });
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
        String theme = configManager.getTheme();
        // 30 - black, 37 - white (standard ANSI)
        String colorCode = ("Light".equals(theme) || "Светлый".equals(theme) || "Gruvbox Light".equals(theme)) ? "30" : "37";

        try {
            // Очистка экрана для немедленного заполнения фоновым цветом
            connector.writeToTerminal("\033[H\033[2J");
            while (connecting.get()) {
                String msg = "\r\033[" + colorCode + "mПодключение к " + host + "... " + spinner[i % spinner.length] + "\033[0m";
                connector.writeToTerminal(msg);
                i++;
                Thread.sleep(100);
            }
        } catch (InterruptedException ignored) {
        }
        // Очистить строку подключения после завершения
        connector.writeToTerminal("\r\033[K");
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
