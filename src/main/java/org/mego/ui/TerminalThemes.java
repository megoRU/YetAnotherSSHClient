package org.mego.ui;

import com.jediterm.terminal.ui.settings.DefaultColorScheme;
import java.awt.Color;

public class TerminalThemes {

    public static class Dark extends DefaultColorScheme {
        @Override public Color getForeground() { return Color.decode("#ADADAD"); }
        @Override public Color getBackground() { return Color.decode("#1E1E1E"); }
    }

    public static class Light extends DefaultColorScheme {
        // Uses defaults from DefaultColorScheme
    }

    public static class GruvboxLight extends DefaultColorScheme {
        @Override public Color getForeground() { return Color.decode("#3c3836"); }
        @Override public Color getBackground() { return Color.decode("#fbf1c7"); }
        @Override public Color getSelectionForeground() { return Color.decode("#fbf1c7"); }
        @Override public Color getSelectionBackground() { return Color.decode("#a89984"); }
        @Override public Color getCursorColor() { return Color.decode("#3c3836"); }
    }
}
