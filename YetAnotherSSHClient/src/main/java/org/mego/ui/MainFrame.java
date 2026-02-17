package org.mego.ui;

import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.keyverifier.AcceptAllServerKeyVerifier;
import org.mego.config.ConfigManager;
import org.mego.config.FavoritesManager;
import org.mego.ssh.SshTtyConnector;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.util.List;

public class MainFrame extends JFrame {
    private final ConfigManager configManager;
    private final FavoritesManager favoritesManager;
    private final SshClient sshClient;
    private final JTabbedPane tabbedPane;
    private JMenu favoritesMenu;
    private DefaultListModel<String> favoritesListModel;
    private JList<String> favoritesList;

    public MainFrame(ConfigManager configManager) {
        super("Мини SSH клиент");
        this.configManager = configManager;
        this.favoritesManager = new FavoritesManager();

        this.sshClient = SshClient.setUpDefaultClient();
        this.sshClient.setServerKeyVerifier(AcceptAllServerKeyVerifier.INSTANCE);
        this.sshClient.start();

        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        restoreWindowPosition();

        tabbedPane = new JTabbedPane();
        tabbedPane.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2) {
                    int index = tabbedPane.getSelectedIndex();
                    if (index != -1) {
                        closeTab(index);
                    }
                }
            }
        });
        add(tabbedPane, BorderLayout.CENTER);

        favoritesListModel = new DefaultListModel<>();
        favoritesList = new JList<>(favoritesListModel);
        favoritesList.addMouseListener(new MouseAdapter() {
            @Override
            public void mouseClicked(MouseEvent e) {
                if (e.getClickCount() == 2) {
                    connectToSelectedFavorite();
                } else if (SwingUtilities.isRightMouseButton(e)) {
                    int index = favoritesList.locationToIndex(e.getPoint());
                    if (index != -1) {
                        favoritesList.setSelectedIndex(index);
                        showFavoritesContextMenu(e.getComponent(), e.getX(), e.getY());
                    }
                }
            }
        });

        JPanel sidebar = new JPanel(new BorderLayout());
        sidebar.setPreferredSize(new Dimension(200, 0));
        sidebar.setBorder(BorderFactory.createTitledBorder("Избранное"));
        sidebar.add(new JScrollPane(favoritesList), BorderLayout.CENTER);

        add(sidebar, BorderLayout.WEST);

        initUI();
        updateFavorites();

        addWindowListener(new WindowAdapter() {
            @Override
            public void windowClosing(WindowEvent e) {
                saveWindowPosition();
                for (int i = 0; i < tabbedPane.getTabCount(); i++) {
                    Component c = tabbedPane.getComponentAt(i);
                    if (c instanceof SshTerminalTab) {
                        ((SshTerminalTab) c).close();
                    }
                }
                try {
                    sshClient.stop();
                } catch (Exception ex) {
                    ex.printStackTrace();
                }
            }
        });
    }

    private void connectToSelectedFavorite() {
        int index = favoritesList.getSelectedIndex();
        if (index != -1) {
            FavoritesManager.Favorite fav = favoritesManager.loadFavorites().get(index);
            startSshSession(fav.user, fav.host, fav.port, fav.password);
        }
    }

    private void showFavoritesContextMenu(Component invoker, int x, int y) {
        JPopupMenu menu = new JPopupMenu();
        JMenuItem connectItem = new JMenuItem("Подключиться");
        connectItem.addActionListener(e -> connectToSelectedFavorite());

        JMenuItem editItem = new JMenuItem("Редактировать");
        editItem.addActionListener(e -> {
            int index = favoritesList.getSelectedIndex();
            if (index != -1) {
                FavoritesManager.Favorite fav = favoritesManager.loadFavorites().get(index);
                showFavoriteDialog(index, fav);
            }
        });

        JMenuItem deleteItem = new JMenuItem("Удалить");
        deleteItem.addActionListener(e -> {
            int index = favoritesList.getSelectedIndex();
            if (index != -1) {
                int confirm = JOptionPane.showConfirmDialog(this, "Вы уверены, что хотите удалить этот сервер из избранного?", "Удаление", JOptionPane.YES_NO_OPTION);
                if (confirm == JOptionPane.YES_OPTION) {
                    List<FavoritesManager.Favorite> favorites = favoritesManager.loadFavorites();
                    favorites.remove(index);
                    favoritesManager.saveFavorites(favorites);
                    updateFavorites();
                }
            }
        });

        menu.add(connectItem);
        menu.addSeparator();
        menu.add(editItem);
        menu.add(deleteItem);
        menu.show(invoker, x, y);
    }

    private void closeTab(int index) {
        Component c = tabbedPane.getComponentAt(index);
        if (c instanceof SshTerminalTab) {
            ((SshTerminalTab) c).close();
        }
        tabbedPane.remove(index);
    }

    private void initUI() {
        JMenuBar menuBar = new JMenuBar();

        JMenu fileMenu = new JMenu("Файл");
        JMenuItem newConnItem = new JMenuItem("Новое подключение");
        newConnItem.addActionListener(e -> showNewConnectionDialog());
        fileMenu.add(newConnItem);

        favoritesMenu = new JMenu("Избранное");
        fileMenu.add(favoritesMenu);

        JMenu settingsMenu = new JMenu("Настройки");
        JMenuItem settingsItem = new JMenuItem("Параметры");
        settingsItem.addActionListener(e -> {
            new SettingsDialog(this, configManager).setVisible(true);
            refreshAllTabs();
        });
        settingsMenu.add(settingsItem);

        menuBar.add(fileMenu);
        menuBar.add(settingsMenu);
        setJMenuBar(menuBar);

        // Toolbar
        JToolBar toolBar = new JToolBar();
        toolBar.setFloatable(false);

        JButton newConnBtn = new JButton("Новое подключение");
        newConnBtn.putClientProperty("FlatLaf.style", "arc: 10; background: #0078d4; foreground: #ffffff; hoverBackground: #005a9e");
        newConnBtn.addActionListener(e -> showNewConnectionDialog());
        toolBar.add(newConnBtn);

        toolBar.addSeparator();

        JButton addFavBtn = new JButton("Добавить в избранное");
        addFavBtn.putClientProperty("FlatLaf.style", "arc: 10; background: #2d2d2d; foreground: #ffffff; hoverBackground: #3d3d3d");
        addFavBtn.addActionListener(e -> addCurrentToFavorites());
        toolBar.add(addFavBtn);

        add(toolBar, BorderLayout.NORTH);
    }

    private void refreshAllTabs() {
        for (int i = 0; i < tabbedPane.getTabCount(); i++) {
            Component c = tabbedPane.getComponentAt(i);
            if (c instanceof SshTerminalTab) {
                ((SshTerminalTab) c).updateSettings();
            }
        }
    }

    private void updateFavorites() {
        favoritesListModel.clear();
        favoritesMenu.removeAll();
        List<FavoritesManager.Favorite> favorites = favoritesManager.loadFavorites();
        for (FavoritesManager.Favorite fav : favorites) {
            String label = fav.name;
            favoritesListModel.addElement(label);

            JMenuItem item = new JMenuItem(fav.name + " (" + fav.user + "@" + fav.host + ":" + fav.port + ")");
            item.addActionListener(e -> startSshSession(fav.user, fav.host, fav.port, fav.password));
            favoritesMenu.add(item);
        }
    }

    private void showNewConnectionDialog() {
        JPanel panel = new JPanel(new GridLayout(4, 2, 5, 5));
        JTextField hostField = new JTextField("77.110.97.210");
        JTextField userField = new JTextField("root");
        JTextField portField = new JTextField("12222");
        JPasswordField passField = new JPasswordField();

        panel.add(new JLabel("Хост:"));
        panel.add(hostField);
        panel.add(new JLabel("Пользователь:"));
        panel.add(userField);
        panel.add(new JLabel("Порт:"));
        panel.add(portField);
        panel.add(new JLabel("Пароль:"));
        panel.add(passField);

        int result = JOptionPane.showConfirmDialog(this, panel, "Новое подключение", JOptionPane.OK_CANCEL_OPTION);
        if (result == JOptionPane.OK_OPTION) {
            startSshSession(userField.getText(), hostField.getText(), portField.getText(), new String(passField.getPassword()));
        }
    }

    private void addCurrentToFavorites() {
        int index = tabbedPane.getSelectedIndex();
        if (index == -1) return;

        Component c = tabbedPane.getComponentAt(index);
        if (c instanceof SshTerminalTab) {
            SshTerminalTab tab = (SshTerminalTab) c;
            showFavoriteDialog(null, new FavoritesManager.Favorite(tab.getHost(), tab.getUser(), tab.getHost(), tab.getPort(), tab.getPassword()));
        }
    }

    private void showFavoriteDialog(Integer favoriteIndex, FavoritesManager.Favorite initialData) {
        JPanel panel = new JPanel(new GridBagLayout());
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.insets = new Insets(5, 5, 5, 5);

        JTextField nameField = new JTextField(initialData != null ? initialData.name : "");
        JTextField hostField = new JTextField(initialData != null ? initialData.host : "");
        JTextField userField = new JTextField(initialData != null ? initialData.user : "root");
        JTextField portField = new JTextField(initialData != null ? initialData.port : "22");
        JPasswordField passField = new JPasswordField(initialData != null ? initialData.password : "");

        gbc.gridx = 0; gbc.gridy = 0; panel.add(new JLabel("Название:"), gbc);
        gbc.gridx = 1; panel.add(nameField, gbc);

        gbc.gridx = 0; gbc.gridy = 1; panel.add(new JLabel("Хост:"), gbc);
        gbc.gridx = 1; panel.add(hostField, gbc);

        gbc.gridx = 0; gbc.gridy = 2; panel.add(new JLabel("Пользователь:"), gbc);
        gbc.gridx = 1; panel.add(userField, gbc);

        gbc.gridx = 0; gbc.gridy = 3; panel.add(new JLabel("Порт:"), gbc);
        gbc.gridx = 1; panel.add(portField, gbc);

        gbc.gridx = 0; gbc.gridy = 4; panel.add(new JLabel("Пароль:"), gbc);
        gbc.gridx = 1; panel.add(passField, gbc);

        JCheckBox showPass = new JCheckBox("Показать пароль");
        showPass.addActionListener(e -> {
            if (showPass.isSelected()) {
                passField.setEchoChar((char) 0);
            } else {
                passField.setEchoChar('•');
            }
        });
        gbc.gridx = 1; gbc.gridy = 5; panel.add(showPass, gbc);

        int result = JOptionPane.showConfirmDialog(this, panel, favoriteIndex == null ? "Добавить в избранное" : "Редактировать", JOptionPane.OK_CANCEL_OPTION);
        if (result == JOptionPane.OK_OPTION) {
            FavoritesManager.Favorite newFav = new FavoritesManager.Favorite(
                    nameField.getText(),
                    userField.getText(),
                    hostField.getText(),
                    portField.getText(),
                    new String(passField.getPassword())
            );

            List<FavoritesManager.Favorite> favorites = favoritesManager.loadFavorites();
            if (favoriteIndex == null) {
                favoritesManager.addFavorite(newFav);
            } else {
                favorites.set(favoriteIndex, newFav);
                favoritesManager.saveFavorites(favorites);
            }
            updateFavorites();
        }
    }

    private void startSshSession(String user, String host, String port, String password) {
        new Thread(() -> {
            try {
                SshTtyConnector connector = new SshTtyConnector(sshClient, user, host, Integer.parseInt(port), password);
                if (connector.connect()) {
                    SwingUtilities.invokeLater(() -> {
                        SshTerminalTab tab = new SshTerminalTab(connector, configManager, user, host, port, password);
                        int count = tabbedPane.getTabCount();
                        tabbedPane.addTab(tab.getTitle(), tab);
                        tabbedPane.setTabComponentAt(count, new ButtonTabComponent(tabbedPane));
                        tabbedPane.setSelectedComponent(tab);
                    });
                } else {
                    SwingUtilities.invokeLater(() -> JOptionPane.showMessageDialog(this, "Ошибка подключения к " + host));
                }
            } catch (Exception e) {
                e.printStackTrace();
                SwingUtilities.invokeLater(() -> JOptionPane.showMessageDialog(this, "Ошибка: " + e.getMessage()));
            }
        }).start();
    }

    private void saveWindowPosition() {
        configManager.setInt("x", getX());
        configManager.setInt("y", getY());
        configManager.setInt("width", getWidth());
        configManager.setInt("height", getHeight());
        configManager.save();
    }

    private void restoreWindowPosition() {
        int x = configManager.getInt("x", 100);
        int y = configManager.getInt("y", 100);
        int width = configManager.getInt("width", 1000);
        int height = configManager.getInt("height", 700);
        setBounds(x, y, width, height);
    }

    private class ButtonTabComponent extends JPanel {
        private final JTabbedPane pane;

        public ButtonTabComponent(final JTabbedPane pane) {
            super(new FlowLayout(FlowLayout.LEFT, 0, 0));
            this.pane = pane;
            setOpaque(false);

            JLabel label = new JLabel() {
                public String getText() {
                    int i = pane.indexOfTabComponent(ButtonTabComponent.this);
                    if (i != -1) {
                        return pane.getTitleAt(i);
                    }
                    return null;
                }
            };
            add(label);
            label.setBorder(BorderFactory.createEmptyBorder(0, 0, 0, 5));

            JButton button = new JButton("x");
            button.setPreferredSize(new Dimension(17, 17));
            button.setMargin(new Insets(0, 0, 0, 0));
            button.addActionListener(e -> {
                int i = pane.indexOfTabComponent(ButtonTabComponent.this);
                if (i != -1) {
                    closeTab(i);
                }
            });
            add(button);
            setBorder(BorderFactory.createEmptyBorder(2, 0, 0, 0));
        }
    }
}
