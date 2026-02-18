package main.ui;

import main.config.ConfigManager;
import main.config.ServerInfo;
import main.ssh.SshTtyConnector;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.apache.sshd.client.SshClient;
import org.apache.sshd.client.keyverifier.AcceptAllServerKeyVerifier;

import javax.swing.*;
import java.awt.*;
import java.awt.event.MouseAdapter;
import java.awt.event.MouseEvent;
import java.awt.event.WindowAdapter;
import java.awt.event.WindowEvent;
import java.util.List;

public class MainFrame extends JFrame {

    private static final Logger LOGGER = LoggerFactory.getLogger(MainFrame.class);
    private final ConfigManager configManager;
    private final SshClient sshClient;
    private final JTabbedPane tabbedPane;
    private JMenu favoritesMenu;
    private final DefaultListModel<String> favoritesListModel;
    private final JList<String> favoritesList;

    public MainFrame(ConfigManager configManager) {
        super("YetAnotherSSHClient");

        JPopupMenu.setDefaultLightWeightPopupEnabled(false);
        ToolTipManager.sharedInstance().setLightWeightPopupEnabled(false);

        this.configManager = configManager;

        this.sshClient = SshClient.setUpDefaultClient();
        this.sshClient.setServerKeyVerifier(AcceptAllServerKeyVerifier.INSTANCE);
        this.sshClient.start();

        setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        restoreWindowPosition();

        tabbedPane = new JTabbedPane();
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
                   LOGGER.error("SshTtyConnector stop failed", ex);
                }
            }
        });
    }

    private void connectToSelectedFavorite() {
        int index = favoritesList.getSelectedIndex();
        if (index != -1) {
            ServerInfo fav = configManager.getFavorites().get(index);
            startSshSession(fav.user, fav.host, fav.port, fav.password, fav.identityFile);
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
                ServerInfo fav = configManager.getFavorites().get(index);
                showFavoriteDialog(index, fav);
            }
        });

        JMenuItem deleteItem = new JMenuItem("Удалить");
        deleteItem.addActionListener(e -> {
            int index = favoritesList.getSelectedIndex();
            if (index != -1) {
                int confirm = JOptionPane.showConfirmDialog(this, "Вы уверены, что хотите удалить этот сервер из избранного?", "Удаление", JOptionPane.YES_NO_OPTION);
                if (confirm == JOptionPane.YES_OPTION) {
                    configManager.removeFavorite(index);
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
        JMenuBar existingMenuBar = getJMenuBar();
        if (existingMenuBar != null) {
            existingMenuBar.removeAll();
        }
        JMenuBar menuBar = new JMenuBar();

        favoritesMenu = new JMenu("Избранное");

        JMenu settingsMenu = new JMenu("Настройки");
        JMenuItem settingsItem = new JMenuItem("Параметры");
        settingsItem.addActionListener(e -> {
            new SettingsDialog(this, configManager).setVisible(true);
            refreshAllTabs();
        });
        settingsMenu.add(settingsItem);

        JMenu helpMenu = new JMenu("Справка");
        JMenuItem aboutItem = new JMenuItem("О программе");
        aboutItem.addActionListener(e -> {
            JLabel label = new JLabel("<html>YetAnotherSSHClient<br>Версия: 1.0<br>Сайт: <a href=\"https://megoru.ru\">megoru.ru</a></html>");
            label.setCursor(Cursor.getPredefinedCursor(Cursor.HAND_CURSOR));
            label.addMouseListener(new MouseAdapter() {
                @Override
                public void mouseClicked(MouseEvent e) {
                    try {
                        Desktop.getDesktop().browse(new java.net.URI("https://megoru.ru"));
                    } catch (Exception ex) {
                        LOGGER.error("Failed to open link", ex);
                    }
                }
            });
            JOptionPane.showMessageDialog(this, label, "О программе", JOptionPane.INFORMATION_MESSAGE);
        });
        helpMenu.add(aboutItem);

        menuBar.add(favoritesMenu);
        menuBar.add(settingsMenu);
        menuBar.add(helpMenu);
        setJMenuBar(menuBar);

        // Toolbar
        JToolBar toolBar = new JToolBar();
        toolBar.setFloatable(false);

        JButton newConnBtn = new JButton("Новое подключение");
        newConnBtn.putClientProperty("FlatLaf.style", "arc: 10; foreground: #ffffff; hoverBackground: #005a9e; borderWidth: 1; borderColor: #ffffff; margin: 2,5,2,5");
        newConnBtn.setOpaque(true); // обязательно, чтобы фон отображался
        newConnBtn.setBackground(new Color(0, 120, 212));
        newConnBtn.addActionListener(e -> showNewConnectionDialog());
        toolBar.add(newConnBtn);

        toolBar.addSeparator();

        JButton addFavBtn = new JButton("Добавить в избранное");
        addFavBtn.putClientProperty("FlatLaf.style", "arc: 10; foreground: #ffffff; hoverBackground: #3d3d3d; borderWidth: 1; borderColor: #ffffff; margin: 2,5,2,5");
        addFavBtn.setOpaque(true);
        addFavBtn.setBackground(new Color(45, 45, 45));
        addFavBtn.addActionListener(e -> addCurrentToFavorites());
        toolBar.add(addFavBtn);

        JPanel topPanel = new JPanel(new BorderLayout());
        topPanel.add(toolBar, BorderLayout.NORTH);
        toolBar.setBorder(BorderFactory.createEmptyBorder(2, 5, 2, 5));
        add(topPanel, BorderLayout.NORTH);
    }

    private void refreshAllTabs() {
        for (int i = 0; i < tabbedPane.getTabCount(); i++) {
            Component c = tabbedPane.getComponentAt(i);
            if (c instanceof SshTerminalTab) {
                ((SshTerminalTab) c).updateSettings();
            }
        }
        revalidate();
        repaint();
    }

    private void updateFavorites() {
        favoritesListModel.clear();
        favoritesMenu.removeAll();

        JMenuItem addCurrentItem = new JMenuItem("Добавить текущее в избранное");
        addCurrentItem.addActionListener(e -> addCurrentToFavorites());
        favoritesMenu.add(addCurrentItem);
        favoritesMenu.addSeparator();

        List<ServerInfo> favorites = configManager.getFavorites();
        for (ServerInfo fav : favorites) {
            String label = fav.name;
            favoritesListModel.addElement(label);

            JMenuItem item = new JMenuItem(fav.name + " (" + fav.user + "@" + fav.host + ":" + fav.port + ")");
            item.addActionListener(e -> startSshSession(fav.user, fav.host, fav.port, fav.password, fav.identityFile));
            favoritesMenu.add(item);
        }
    }

    private void showNewConnectionDialog() {
        showFavoriteDialog(-1, null);
    }

    private void addCurrentToFavorites() {
        int index = tabbedPane.getSelectedIndex();
        if (index == -1) return;

        Component c = tabbedPane.getComponentAt(index);
        if (c instanceof SshTerminalTab tab) {
            ServerInfo serverInfo = new ServerInfo(tab.getHost(), tab.getUser(), tab.getHost(), tab.getPort(), tab.getPassword(), tab.getIdentityFile());
            showFavoriteDialog(null, serverInfo);
        }
    }

    private void showFavoriteDialog(Integer favoriteIndex, ServerInfo initialData) {
        JPanel panel = new JPanel(new GridBagLayout());
        GridBagConstraints gbc = new GridBagConstraints();
        gbc.fill = GridBagConstraints.HORIZONTAL;
        gbc.insets = new Insets(5, 5, 5, 5);

        JTextField nameField = new JTextField(initialData != null ? initialData.name : "");
        JTextField hostField = new JTextField(initialData != null ? initialData.host : "");
        JTextField userField = new JTextField(initialData != null ? initialData.user : "root");
        JTextField portField = new JTextField(initialData != null ? initialData.port : "22");
        JPasswordField passField = new JPasswordField(initialData != null ? initialData.password : "");
        JTextField keyField = new JTextField(initialData != null ? initialData.identityFile : "");
        JButton keyBtn = new JButton("...");
        keyBtn.addActionListener(e -> {
            JFileChooser fc = new JFileChooser();
            if (fc.showOpenDialog(this) == JFileChooser.APPROVE_OPTION) {
                keyField.setText(fc.getSelectedFile().getAbsolutePath());
            }
        });

        int row = 0;
        gbc.gridx = 0; gbc.gridy = row; panel.add(new JLabel("Название:"), gbc);
        gbc.gridx = 1; panel.add(nameField, gbc);

        row++;
        gbc.gridx = 0; gbc.gridy = row; panel.add(new JLabel("Хост:"), gbc);
        gbc.gridx = 1; panel.add(hostField, gbc);

        row++;
        gbc.gridx = 0; gbc.gridy = row; panel.add(new JLabel("Пользователь:"), gbc);
        gbc.gridx = 1; panel.add(userField, gbc);

        row++;
        gbc.gridx = 0; gbc.gridy = row; panel.add(new JLabel("Порт:"), gbc);
        gbc.gridx = 1; panel.add(portField, gbc);

        row++;
        gbc.gridx = 0; gbc.gridy = row; panel.add(new JLabel("Пароль:"), gbc);
        gbc.gridx = 1; panel.add(passField, gbc);

        row++;
        JCheckBox showPass = new JCheckBox("Показать пароль");
        showPass.addActionListener(e -> {
            if (showPass.isSelected()) {
                passField.setEchoChar((char) 0);
            } else {
                passField.setEchoChar('•');
            }
        });
        gbc.gridx = 1; gbc.gridy = row; panel.add(showPass, gbc);

        row++;
        gbc.gridx = 0; gbc.gridy = row; panel.add(new JLabel("Файл ключа:"), gbc);
        JPanel keyPanel = new JPanel(new BorderLayout());
        keyPanel.add(keyField, BorderLayout.CENTER);
        keyPanel.add(keyBtn, BorderLayout.EAST);
        gbc.gridx = 1; panel.add(keyPanel, gbc);

        String title = "Новое подключение";
        String okButtonText = "Подключиться";
        if (favoriteIndex != null) {
            if (favoriteIndex >= 0) {
                title = "Редактировать";
                okButtonText = "Сохранить";
            }
        } else {
            okButtonText = "Добавить";
        }

        int result = JOptionPane.showOptionDialog(this, panel, title,
                JOptionPane.OK_CANCEL_OPTION, JOptionPane.PLAIN_MESSAGE,
                null, new Object[]{okButtonText, "Отмена"}, okButtonText);

        if (result == JOptionPane.OK_OPTION) {
            ServerInfo newFav = new ServerInfo(
                    nameField.getText().isEmpty() ? hostField.getText() : nameField.getText(),
                    userField.getText(),
                    hostField.getText(),
                    portField.getText(),
                    new String(passField.getPassword()),
                    keyField.getText()
            );

            if (favoriteIndex == null) {
                configManager.addFavorite(newFav);
                updateFavorites();
            } else if (favoriteIndex >= 0) {
                configManager.updateFavorite(favoriteIndex, newFav);
                updateFavorites();
            } else {
                // index -1 means just connect without saving
                startSshSession(newFav.user, newFav.host, newFav.port, newFav.password, newFav.identityFile);
            }
        }
    }

    private void startSshSession(String user, String host, String port, String password, String identityFile) {
        SshTerminalTab tab = new SshTerminalTab(sshClient, configManager, user, host, port, password, identityFile);
        int count = tabbedPane.getTabCount();
        tabbedPane.addTab(tab.getTitle(), tab);
        tabbedPane.setTabComponentAt(count, new ButtonTabComponent(tabbedPane));
        tabbedPane.setSelectedComponent(tab);
        tab.requestFocusInWindow();
        tab.connect();
    }

    private void saveWindowPosition() {
        int state = getExtendedState();
        if ((state & MAXIMIZED_BOTH) != 0) {
            configManager.setMaximized(true);
        } else {
            configManager.setMaximized(false);
            configManager.setX(getX());
            configManager.setY(getY());
            configManager.setWidth(getWidth());
            configManager.setHeight(getHeight());
        }
        configManager.save();
    }

    private void restoreWindowPosition() {
        int x = configManager.getX();
        int y = configManager.getY();
        int width = configManager.getWidth();
        int height = configManager.getHeight();
        setBounds(x, y, width, height);
        if (configManager.isMaximized()) {
            setExtendedState(MAXIMIZED_BOTH);
        }
    }

    private class ButtonTabComponent extends JPanel {

        public ButtonTabComponent(final JTabbedPane pane) {
            super(new FlowLayout(FlowLayout.LEFT, 0, 0));
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
