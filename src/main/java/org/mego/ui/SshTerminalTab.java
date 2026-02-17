package org.mego.ui;

import com.jediterm.terminal.ui.JediTermWidget;
import com.jediterm.terminal.ui.settings.DefaultSettingsProvider;
import com.jediterm.terminal.ui.settings.ColorScheme;
import com.jediterm.terminal.ui.settings.DefaultColorScheme;
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
            public ColorScheme getColorScheme() {
                String theme = configManager.getTheme();
                if ("Gruvbox Light".equals(theme)) {
                    return new GruvboxLightColorScheme();
                } else if ("Light".equals(theme)) {
                    return new DefaultColorScheme();
                } else {
                    return new DarkColorScheme();
                }
            }
        }) {
            @Override
            protected JScrollBar createScrollBar() {
                JScrollBar bar = super.createScrollBar();
                bar.setUnitIncrement(16);
                bar.putClientProperty("FlatLaf.style", "track: #00000000; thumbArc: 999; width: 12");
                return bar;
            }
        };

        terminalWidget.setTtyConnector(connector);
        add(terminalWidget, BorderLayout.CENTER);
        terminalWidget.start();
    }

    public void updateSettings() {
        terminalWidget.setFont(configManager.getFont());
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

    private static class DarkColorScheme extends DefaultColorScheme {
        @Override public Color getForeground() { return Color.decode("#ADADAD"); }
        @Override public Color getBackground() { return Color.decode("#1E1E1E"); }
    }

    private static class GruvboxLightColorScheme extends DefaultColorScheme {
        @Override public Color getForeground() { return Color.decode("#3c3836"); }
        @Override public Color getBackground() { return Color.decode("#fbf1c7"); }
        @Override public Color getSelectionForeground() { return Color.decode("#fbf1c7"); }
        @Override public Color getSelectionBackground() { return Color.decode("#a89984"); }
        @Override public Color getCursorColor() { return Color.decode("#3c3836"); }
    }

    @Override
    public boolean requestFocusInWindow() {
        return terminalWidget.requestFocusInWindow();
    }
}
