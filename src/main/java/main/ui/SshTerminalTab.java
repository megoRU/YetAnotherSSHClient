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
    private Timer autoReconnectTimer;

    private final JPanel contentPanel;
    private final CardLayout contentLayout;
    private final JPanel statusPanel;
    private final JLabel statusLabel;
    private final JLabel errorLabel;
    private final JButton statusReconnectBtn;

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

        contentLayout = new CardLayout();
        contentPanel = new JPanel(contentLayout);
        contentPanel.setOpaque(false);

        statusPanel = new JPanel(new GridBagLayout());
        statusPanel.setOpaque(false);

        GridBagConstraints gbc = new GridBagConstraints();
        gbc.gridx = 0;
        gbc.gridy = GridBagConstraints.RELATIVE;
        gbc.insets = new Insets(10, 20, 10, 20);
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.anchor = GridBagConstraints.CENTER;

        JLabel hostLabel = new JLabel(name + " (" + host + ")");
        hostLabel.setFont(hostLabel.getFont().deriveFont(Font.BOLD, 18f));
        hostLabel.setHorizontalAlignment(SwingConstants.CENTER);
        statusPanel.add(hostLabel, gbc);

        statusLabel = new JLabel("Подключение...");
        statusLabel.setFont(statusLabel.getFont().deriveFont(14f));
        statusLabel.setHorizontalAlignment(SwingConstants.CENTER);
        statusPanel.add(statusLabel, gbc);

        errorLabel = new JLabel();
        Color errorColor = UIManager.getColor("Actions.Red");
        errorLabel.setForeground(errorColor != null ? errorColor : Color.RED);
        errorLabel.setHorizontalAlignment(SwingConstants.CENTER);
        errorLabel.setVisible(false);
        statusPanel.add(errorLabel, gbc);

        statusReconnectBtn = new JButton("Переподключиться");
        statusReconnectBtn.putClientProperty(FlatClientProperties.BUTTON_TYPE, FlatClientProperties.BUTTON_TYPE_ROUND_RECT);
        statusReconnectBtn.setVisible(false);
        statusReconnectBtn.addActionListener(e -> connect());

        JPanel btnWrapper = new JPanel(new FlowLayout(FlowLayout.CENTER));
        btnWrapper.setOpaque(false);
        btnWrapper.add(statusReconnectBtn);
        statusPanel.add(btnWrapper, gbc);

        contentPanel.add(statusPanel, "STATUS");

        this.connector.setOnDisconnect(() -> SwingUtilities.invokeLater(() -> {
            if (!connecting.get()) {
                showStatus("Соединение разорвано", null);
                statusReconnectBtn.setVisible(true);
                contentLayout.show(contentPanel, "STATUS");

                if (configManager.isAutoReconnect()) {
                    connect();
                }
            }
        }));

        add(contentPanel, BorderLayout.CENTER);

        initTerminalWidget();
    }

    private void showStatus(String message, String error) {
        statusLabel.setText(message);
        if (error != null) {
            errorLabel.setText("<html><center>" + error + "</center></html>");
            errorLabel.setVisible(true);
        } else {
            errorLabel.setVisible(false);
        }
    }

    private void initTerminalWidget() {
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
            public ColorPalette getTerminalColorPalette() {
                return new ColorPalette() {

                    private com.jediterm.core.Color bg() {
                        Color c = UIManager.getColor("Panel.background");
                        if (c == null) c = Color.WHITE;
                        return new com.jediterm.core.Color(c.getRed(), c.getGreen(), c.getBlue());
                    }

                    private com.jediterm.core.Color fg() {
                        Color c = UIManager.getColor("Panel.foreground");
                        if (c == null) c = Color.BLACK;
                        return new com.jediterm.core.Color(c.getRed(), c.getGreen(), c.getBlue());
                    }

                    @Override
                    protected com.jediterm.core.@NotNull Color getForegroundByColorIndex(int i) {
                        if (i == 0 || i == 7 || i == 15) {
                            return fg(); // дефолтный текст под тему
                        }
                        return ColorPaletteImpl.XTERM_PALETTE.getForeground(new TerminalColor(i));
                    }

                    @Override
                    protected com.jediterm.core.@NotNull Color getBackgroundByColorIndex(int i) {
                        if (i == 0 || i == 7 || i == 15) {
                            return bg(); // фон всегда = цвет темы
                        }
                        return ColorPaletteImpl.XTERM_PALETTE.getBackground(new TerminalColor(i));
                    }
                };
            }

            @Override
            public @NotNull TerminalColor getDefaultBackground() {
                Color bg = UIManager.getColor("Panel.background");
                if (bg == null) bg = Color.WHITE;
                return new TerminalColor(bg.getRed(), bg.getGreen(), bg.getBlue());
            }

            @Override
            public @NotNull TerminalColor getDefaultForeground() {
                Color fg = UIManager.getColor("Panel.foreground");
                if (fg == null) fg = Color.BLACK;
                return new TerminalColor(fg.getRed(), fg.getGreen(), fg.getBlue());
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
                Color c = UIManager.getColor("Terminal.hyperlinkColor");
                if (c == null) c = new Color(210, 84, 154);
                return new TextStyle(new TerminalColor(c.getRed(), c.getGreen(), c.getBlue()), null, EnumSet.noneOf(TextStyle.Option.class));
            }
        }) {
            @Override
            protected JScrollBar createScrollBar() {
                JScrollBar bar = super.createScrollBar();
                bar.updateUI();
                bar.setUnitIncrement(16);
                bar.putClientProperty(FlatClientProperties.SCROLL_BAR_SHOW_BUTTONS, false);
                return bar;
            }
        };

        terminalWidget.setTtyConnector(connector);
        contentPanel.add(terminalWidget, "TERMINAL");
    }

    public void connect() {
        if (connecting.compareAndSet(false, true)) {
            showStatus("Подключение к " + host + "...", null);
            statusReconnectBtn.setVisible(false);
            contentLayout.show(contentPanel, "STATUS");

            stopAutoReconnectTimer();
            new Thread(() -> {
                try {
                    try {
                        SwingUtilities.invokeAndWait(() -> {
                            if (terminalWidget != null) {
                                terminalWidget.close();
                                contentPanel.remove(terminalWidget);
                            }
                            initTerminalWidget();
                            revalidate();
                            repaint();
                        });
                    } catch (Exception e) {
                        LOGGER.error("SshTtyConnector connect failed", e);
                    }

                    connector.initPreConnectionPipe();

                    SwingUtilities.invokeLater(() -> {
                        terminalWidget.start();
                    });

                    String error = connector.connect();

                    if (connector.isConnected()) {
                        firstConnect.set(false);
                        SwingUtilities.invokeLater(() -> {
                            contentLayout.show(contentPanel, "TERMINAL");
                            terminalWidget.requestFocusInWindow();
                        });
                    } else {
                        SwingUtilities.invokeLater(() -> {
                            showStatus("Ошибка подключения", error);
                            statusReconnectBtn.setVisible(true);
                        });
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
