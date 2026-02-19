package themes;

import com.formdev.flatlaf.FlatLightLaf;

public class GruvboxLight extends FlatLightLaf {
    public static boolean setup() {
        return setup(new GruvboxLight());
    }

    @Override
    public String getName() {
        return "GruvboxLight";
    }
}
