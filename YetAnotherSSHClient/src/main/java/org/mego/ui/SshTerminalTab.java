package org.mego.ui;

import com.jediterm.terminal.TtyConnector;
import com.jediterm.terminal.ui.JediTermWidget;
import com.jediterm.terminal.ui.settings.DefaultSettingsProvider;
import org.mego.config.ConfigManager;
import org.mego.ssh.SshTtyConnector;

import javax.swing.*;
import java.awt.*;

public class SshTerminalTab extends JPanel {
    private final JediTermWidget terminalWidget;
    private final SshTtyConnector connector;
    private final ConfigManager configManager;

    // Connection info for favorites
    private final String user;
    private final String host;
    private final String port;
    private final String password;

    public SshTerminalTab(SshTtyConnector connector, ConfigManager configManager, String user, String host, String port, String password) {
        this.connector = connector;
        this.configManager = configManager;
        this.user = user;
        this.host = host;
        this.port = port;
        this.password = password;

        setLayout(new BorderLayout());

        terminalWidget = new JediTermWidget(new DefaultSettingsProvider() {
            @Override
            public Font getTerminalFont() {
                return configManager.getFont();
            }

            @Override
            public float getTerminalFontSize() {
                return configManager.getInt("fontSize", 14);
            }
        });

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
        terminalWidget.stop();
        if (connector != null) {
            connector.close();
        }
    }

    public String getTitle() {
        return connector.getName();
    }

    public String getUser() { return user; }
    public String getHost() { return host; }
    public String getPort() { return port; }
    public String getPassword() { return password; }
}
