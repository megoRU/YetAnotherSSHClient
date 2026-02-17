package org.mego.ui;

import com.jediterm.terminal.TerminalColor;
import com.jediterm.terminal.ui.JediTermWidget;
import com.jediterm.terminal.ui.settings.DefaultSettingsProvider;
import lombok.Getter;
import org.mego.config.ConfigManager;
import org.mego.ssh.SshTtyConnector;

import javax.swing.*;
import java.awt.*;

@Getter
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

    public SshTerminalTab(SshTtyConnector connector, ConfigManager configManager, String user, String host, String port, String password, String identityFile) {
        this.connector = connector;
        this.configManager = configManager;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;
        this.identityFile = identityFile;

        setLayout(new BorderLayout());

        terminalWidget = new JediTermWidget(new DefaultSettingsProvider() {
            @Override
            public Font getTerminalFont() {
                return configManager.getFont();
            }

            @Override
            public float getTerminalFontSize() {
                return configManager.getFontSize();
            }

            @Override
            public TerminalColor getDefaultForeground() {
                Color c = getThemeForeground();
                return new TerminalColor(c.getRed(), c.getGreen(), c.getBlue());
            }

            @Override
            public TerminalColor getDefaultBackground() {
                Color c = getThemeBackground();
                return new TerminalColor(c.getRed(), c.getGreen(), c.getBlue());
            }

            @Override
            public boolean enableMouseReporting() {
                return true;
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
        terminalWidget.setFont(configManager.getFont());
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
}
