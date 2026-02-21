package main.ui;

import com.formdev.flatlaf.FlatClientProperties;
import com.formdev.flatlaf.FlatLaf;
import com.formdev.flatlaf.extras.FlatSVGIcon;
import main.config.ConfigManager;
import main.config.ServerInfo;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.util.List;
import java.util.function.Consumer;

public class DashboardPanel extends JPanel {
    private final ConfigManager configManager;
    private final Consumer<ServerInfo> onServerSelected;

    public DashboardPanel(ConfigManager configManager, Consumer<ServerInfo> onServerSelected) {
        this.configManager = configManager;
        this.onServerSelected = onServerSelected;
        setLayout(new BorderLayout());
        setOpaque(false);
    }

    public void refresh() {
        removeAll();
        List<ServerInfo> favorites = configManager.getFavorites();
        if (favorites.isEmpty()) {
            return;
        }

        JLabel header = new JLabel("Выбери сервер для подключения");
        header.setFont(header.getFont().deriveFont(Font.BOLD, 20f));
        header.setHorizontalAlignment(SwingConstants.CENTER);
        header.setBorder(BorderFactory.createEmptyBorder(0, 0, 20, 0));

        JPanel grid = new JPanel(new FlowLayout(FlowLayout.CENTER, 20, 20));
        grid.setOpaque(false);

        for (ServerInfo fav : favorites) {
            grid.add(new ServerBubble(fav, onServerSelected));
        }

        JPanel centeringPanel = new JPanel(new GridBagLayout()) {
            @Override
            public Dimension getPreferredSize() {
                Dimension pref = super.getPreferredSize();
                if (getParent() instanceof JViewport viewport) {
                    pref.width = Math.max(pref.width, viewport.getWidth());
                    pref.height = Math.max(pref.height, viewport.getHeight());
                }
                return pref;
            }
        };
        centeringPanel.setOpaque(false);
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.gridx = 0;
        gbc.gridy = 0;
        gbc.anchor = GridBagConstraints.CENTER;
        centeringPanel.add(header, gbc);

        gbc.gridy = 1;
        centeringPanel.add(grid, gbc);

        JScrollPane scrollPane = new JScrollPane(centeringPanel);
        scrollPane.setBorder(BorderFactory.createEmptyBorder());
        scrollPane.setOpaque(false);
        scrollPane.getViewport().setOpaque(false);
        scrollPane.getVerticalScrollBar().setUnitIncrement(16);

        add(scrollPane, BorderLayout.CENTER);
        revalidate();
        repaint();
    }

    private class ServerBubble extends JPanel {
        public ServerBubble(ServerInfo server, Consumer<ServerInfo> onClick) {
            setLayout(new BorderLayout(10, 10));
            setBorder(BorderFactory.createEmptyBorder(15, 15, 15, 15));
            setPreferredSize(new Dimension(180, 180));

            updateStyle(false);

            // Icon
            String iconPath = "/icons/os/default.svg";
            if (server.osPrettyName != null) {
                String os = server.osPrettyName.toLowerCase();
                if (os.contains("debian")) iconPath = "/icons/os/debian.svg";
                else if (os.contains("ubuntu")) iconPath = "/icons/os/ubuntu.svg";
                else if (os.contains("centos")) iconPath = "/icons/os/centos.svg";
                else if (os.contains("fedora")) iconPath = "/icons/os/fedora.svg";
            }

            try {
                FlatSVGIcon icon = new FlatSVGIcon(getClass().getResource(iconPath));
                icon = icon.derive(64, 64);
                JLabel iconLabel = new JLabel(icon);
                iconLabel.setHorizontalAlignment(SwingConstants.CENTER);
                add(iconLabel, BorderLayout.CENTER);
            } catch (Exception e) {
                JLabel errorLabel = new JLabel("?");
                errorLabel.setFont(errorLabel.getFont().deriveFont(48f));
                errorLabel.setHorizontalAlignment(SwingConstants.CENTER);
                add(errorLabel, BorderLayout.CENTER);
            }

            // Name
            JLabel nameLabel = new JLabel(server.name);
            nameLabel.setHorizontalAlignment(SwingConstants.CENTER);
            nameLabel.setFont(nameLabel.getFont().deriveFont(Font.BOLD, 14f));
            add(nameLabel, BorderLayout.SOUTH);

            setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
            addMouseListener(new MouseAdapter() {
                @Override
                public void mouseClicked(MouseEvent e) {
                    onClick.accept(server);
                }

                @Override
                public void mouseEntered(MouseEvent e) {
                    updateStyle(true);
                    repaint();
                }

                @Override
                public void mouseExited(MouseEvent e) {
                    updateStyle(false);
                    repaint();
                }
            });
        }

        private void updateStyle(boolean hover) {
            String bg;
            if (FlatLaf.isLafDark()) {
                bg = hover ? "lighten($Panel.background, 15%)" : "lighten($Panel.background, 10%)";
            } else {
                String theme = configManager.getTheme();
                if ("Gruvbox Light".equals(theme) || "GruvboxLight".equals(theme)) {
                    bg = hover ? "#d5c4a1" : "#ebdbb2";
                } else {
                    bg = hover ? "#d8d8d8" : "#e8e8e8";
                }
            }

            putClientProperty(FlatClientProperties.STYLE,
                "arc: 25; " +
                "background: " + bg
            );
        }
    }
}
