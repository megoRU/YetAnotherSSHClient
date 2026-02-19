package main.ui;

import com.formdev.flatlaf.FlatClientProperties;
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
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import javax.swing.*;
import java.awt.*;
import java.util.EnumSet;
import java.util.concurrent.atomic.AtomicBoolean;

public class SshTerminalTab extends JPanel {

    private static final Logger LOGGER = LoggerFactory.getLogger(SshTerminalTab.class);

    private JediTermWidget terminalWidget;
    private final SshTtyConnector connector;
    private final ConfigManager configManager;

    private final String user;
    private final String host;
    private final String port;
    private final String password;
    private final String identityFile;
    private final AtomicBoolean connecting = new AtomicBoolean(false);
    private final AtomicBoolean firstConnect = new AtomicBoolean(true);
    private final JPanel reconnectPanel;
    private Timer autoReconnectTimer;

    public SshTerminalTab(SshClient sshClient, ConfigManager configManager, String name, String user, String host, String port, String password, String identityFile) {
        this.configManager = configManager;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;

        setBackground(getThemeBackground());

        this.connector = new SshTtyConnector(sshClient, name, user, host, Integer.parseInt(port), password, identityFile);

        setLayout(new BorderLayout());

        reconnectPanel = new JPanel(new FlowLayout(FlowLayout.CENTER));
        reconnectPanel.setBackground(new Color(200, 50, 50));
        reconnectPanel.setBorder(new javax.swing.border.EmptyBorder(2, 2, 2, 2));

        this.connector.setOnDisconnect(() -> SwingUtilities.invokeLater(() -> {
            if (!connecting.get()) {
                reconnectPanel.setVisible(true);
                if (configManager.isAutoReconnect()) {
                    connect();
                }
            }
        }));

        JButton reconnectBtn = new JButton("Соединение разорвано. Переподключиться?");
        reconnectBtn.putClientProperty(FlatClientProperties.BUTTON_TYPE, FlatClientProperties.BUTTON_TYPE_ROUND_RECT);
        reconnectBtn.setBackground(Color.WHITE);
        reconnectBtn.setForeground(new Color(200, 50, 50));
        reconnectBtn.addActionListener(e -> connect());

        reconnectPanel.add(reconnectBtn);
        reconnectPanel.setVisible(false);
        add(reconnectPanel, BorderLayout.NORTH);

        initTerminalWidget();
    }

    private void initTerminalWidget() {
        terminalWidget = new JediTermWidget(new DefaultSettingsProvider() {

            @Override
            public ColorPalette getTerminalColorPalette() {
                return new ColorPalette() {

                    @Override
                    protected com.jediterm.core.@NotNull Color getForegroundByColorIndex(int i) {
                        // Служебные цвета
                        if (i == 2 || i == 10) return new com.jediterm.core.Color(176, 151, 26);
                        if (i == 5 || i == 13) return new com.jediterm.core.Color(209, 131, 169);
                        if (i == 6 || i == 14) return new com.jediterm.core.Color(66, 141, 153);

                        com.jediterm.core.Color c = ColorPaletteImpl.XTERM_PALETTE.getForeground(new TerminalColor(i));
                        if (!com.formdev.flatlaf.FlatLaf.isLafDark()) return c;
                        return mapDarkThemeColor(c);
                    }

                    @Override
                    protected com.jediterm.core.@NotNull Color getBackgroundByColorIndex(int i) {
                        com.jediterm.core.Color c = ColorPaletteImpl.XTERM_PALETTE.getBackground(new TerminalColor(i));
                        if (com.formdev.flatlaf.FlatLaf.isLafDark()) return mapDarkThemeColor(c);
                        if (i == 7 || i == 15) {
                            Color bg = getThemeBackground();
                            return new com.jediterm.core.Color(bg.getRed(), bg.getGreen(), bg.getBlue());
                        }
                        return c;
                    }

                    private com.jediterm.core.Color mapDarkThemeColor(com.jediterm.core.Color c) {
                        int avg = (c.getRed() + c.getGreen() + c.getBlue()) / 3;
                        if (avg > 200) return new com.jediterm.core.Color(30, 30, 30); // безопасный темный фон
                        return c;
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
                Color bg = com.formdev.flatlaf.FlatLaf.isLafDark() ? new Color(30, 30, 30) : getThemeBackground();
                return new TerminalColor(bg.getRed(), bg.getGreen(), bg.getBlue());
            }

            @Override
            public @NotNull TextStyle getSelectionColor() {
                Color selBg = UIManager.getColor("List.selectionBackground");
                Color selFg = UIManager.getColor("List.selectionForeground");
                if (selBg == null) selBg = new Color(80, 80, 80); // темный, чтобы не резало глаза
                if (selFg == null) selFg = Color.WHITE;
                return new TextStyle(
                        new TerminalColor(selFg.getRed(), selFg.getGreen(), selFg.getBlue()),
                        new TerminalColor(selBg.getRed(), selBg.getGreen(), selBg.getBlue())
                );
            }

            @Override
            public boolean useInverseSelectionColor() {
                return false;
            }

            @Override
            public boolean copyOnSelect() {
                return false;
            }

            @Override
            public TextStyle getHyperlinkColor() {
                return new TextStyle(new TerminalColor(210, 84, 154), null, EnumSet.noneOf(TextStyle.Option.class));
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
    }

    public void connect() {
        if (connecting.compareAndSet(false, true)) {
            reconnectPanel.setVisible(false);
            stopAutoReconnectTimer();
            new Thread(() -> {
                try {
                    try {
                        SwingUtilities.invokeAndWait(() -> {
                            if (terminalWidget != null) {
                                terminalWidget.close();
                                remove(terminalWidget);
                            }
                            initTerminalWidget();
                            revalidate();
                            repaint();
                        });
                    } catch (Exception e) {
                        LOGGER.error("SshTtyConnector connect failed", e);
                    }

                    connector.initPreConnectionPipe();
                    connector.writeToTerminal("\033[H\033[2J");
                    connector.writeToTerminal("Подключение к " + host + "...\r\n");

                    SwingUtilities.invokeLater(() -> {
                        terminalWidget.start();
                        terminalWidget.requestFocusInWindow();
                    });

                    connector.connect();

                    if (connector.isConnected()) {
                        firstConnect.set(false);
                    } else {
                        if (configManager.isAutoReconnect()) {
                            startAutoReconnectTimer();
                        }
                    }
                } finally {
                    connecting.set(false);
                    connector.closePreConnectionPipe();
                }
            }).start();
        }
    }

    private void startAutoReconnectTimer() {
        if (autoReconnectTimer != null && autoReconnectTimer.isRunning()) return;
        autoReconnectTimer = new Timer(5000, e -> {
            if (!connector.isConnected() && !connecting.get()) {
                connect();
            }
        });
        autoReconnectTimer.setRepeats(false);
        autoReconnectTimer.start();
    }

    private void stopAutoReconnectTimer() {
        if (autoReconnectTimer != null) {
            autoReconnectTimer.stop();
        }
    }

    private Color getThemeBackground() {
        Color bg = UIManager.getColor("Panel.background");
        return bg != null ? bg : Color.BLACK;
    }

    private Color getThemeForeground() {
        Color fg = UIManager.getColor("Panel.foreground");
        return fg != null ? fg : Color.WHITE;
    }

    public void updateSettings() {
        terminalWidget.setFont(configManager.getTerminalFont());
        terminalWidget.setBackground(getThemeBackground());
        terminalWidget.setForeground(getThemeForeground());
        terminalWidget.revalidate();
        terminalWidget.repaint();
    }

    public void close() {
        stopAutoReconnectTimer();
        terminalWidget.close();
        if (connector != null) connector.close();
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
