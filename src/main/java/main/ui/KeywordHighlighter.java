package main.ui;

import com.jediterm.terminal.model.hyperlinks.HyperlinkFilter;
import com.jediterm.terminal.model.hyperlinks.LinkInfo;
import com.jediterm.terminal.model.hyperlinks.LinkResult;
import com.jediterm.terminal.model.hyperlinks.LinkResultItem;
import org.jetbrains.annotations.NotNull;
import org.jetbrains.annotations.Nullable;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

public class KeywordHighlighter implements HyperlinkFilter {
    private static final Pattern PATTERN = Pattern.compile(
            "\\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\\b" + // IP
            "|\\b(ERROR|FAIL|FAILED|CRITICAL|ОШИБКА|СБОЙ|WARNING|WARN|ВНИМАНИЕ|ПРЕДУПРЕЖДЕНИЕ|INFO|ИНФО|ИНФОРМАЦИЯ|SUCCESS|OK|УСПЕХ|УСПЕШНО)\\b",
            Pattern.CASE_INSENSITIVE | Pattern.UNICODE_CHARACTER_CLASS
    );

    @Override
    public @Nullable LinkResult apply(@NotNull String line) {
        Matcher matcher = PATTERN.matcher(line);
        List<LinkResultItem> items = new ArrayList<>();
        while (matcher.find()) {
            items.add(new LinkResultItem(matcher.start(), matcher.end(), new LinkInfo(() -> {})));
        }
        return items.isEmpty() ? null : new LinkResult(items);
    }
}
