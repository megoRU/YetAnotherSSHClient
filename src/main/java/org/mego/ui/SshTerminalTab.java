package org.mego.ui;

import com.jediterm.terminal.ui.JediTermWidget;
import com.jediterm.terminal.ui.settings.DefaultSettingsProvider;
import com.jediterm.terminal.emulator.ColorPalette;
import com.jediterm.terminal.emulator.ColorPaletteImpl;
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
            public com.jediterm.terminal.TerminalColor getDefaultForeground() {
                if ("Gruvbox Light".equals(configManager.getTheme())) {
                    return new com.jediterm.terminal.TerminalColor(0x3c3836);
                }
                return super.getDefaultForeground();
            }

            @Override
            public com.jediterm.terminal.TerminalColor getDefaultBackground() {
                if ("Gruvbox Light".equals(configManager.getTheme())) {
                    return new com.jediterm.terminal.TerminalColor(0xfbf1c7);
                }
                return super.getDefaultBackground();
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

    @Override
    public boolean requestFocusInWindow() {
        return terminalWidget.requestFocusInWindow();
    }
}
