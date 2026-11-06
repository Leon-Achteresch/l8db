import java.io.*;
import java.math.BigDecimal;
import java.nio.charset.StandardCharsets;
import java.sql.*;
import java.util.*;

class L8dbJdbcBridge {
    static final int MAX_INPUT = 2 * 1024 * 1024;
    static final int MAX_OUTPUT = 8 * 1024 * 1024;
    static final int MAX_CELL = 256 * 1024;
    static final PrintStream OUTPUT = new PrintStream(new FileOutputStream(FileDescriptor.out), true, StandardCharsets.UTF_8);
    static Connection connection;
    static int rowLimit = 10000;
    static int timeout = 30;

    static String escape(String text) throws SQLException {
        if (text.length() > MAX_CELL) throw new SQLException("JDBC-Zelle überschreitet 256 KiB.");
        StringBuilder result = new StringBuilder("\"");
        for (int index = 0; index < text.length(); index++) {
            char value = text.charAt(index);
            switch (value) {
                case '"': result.append("\\\""); break;
                case '\\': result.append("\\\\"); break;
                case '\n': result.append("\\n"); break;
                case '\r': result.append("\\r"); break;
                case '\t': result.append("\\t"); break;
                default:
                    if (value < 32 || Character.isSurrogate(value)) result.append(String.format("\\u%04x", (int) value));
                    else result.append(value);
            }
        }
        return result.append('"').toString();
    }

    static String value(Object object) throws Exception {
        if (object == null) return "null";
        if (object instanceof Boolean) return object.toString();
        if (object instanceof Byte || object instanceof Short || object instanceof Integer) return object.toString();
        if (object instanceof Long) {
            long number = (Long) object;
            return number >= -9007199254740991L && number <= 9007199254740991L ? object.toString() : escape(object.toString());
        }
        if (object instanceof Float || object instanceof Double) {
            double number = ((Number) object).doubleValue();
            return Double.isFinite(number) ? object.toString() : "null";
        }
        if (object instanceof byte[]) return escape("0x" + HexFormat.of().formatHex((byte[]) object));
        if (object instanceof Blob) {
            Blob blob = (Blob) object;
            if (blob.length() > MAX_CELL / 2) throw new SQLException("JDBC-Binärzelle überschreitet das Limit.");
            return escape("0x" + HexFormat.of().formatHex(blob.getBytes(1, (int) blob.length())));
        }
        if (object instanceof Clob) {
            Clob clob = (Clob) object;
            if (clob.length() > MAX_CELL) throw new SQLException("JDBC-Textzelle überschreitet das Limit.");
            return escape(clob.getSubString(1, (int) clob.length()));
        }
        return escape(object.toString());
    }

    static String result(ResultSet rows, long changes, long started, long offset) throws Exception {
        ResultSetMetaData metadata = rows.getMetaData();
        int columns = metadata.getColumnCount();
        if (columns > 1024) throw new SQLException("JDBC-Ergebnis überschreitet 1024 Spalten.");
        StringBuilder output = new StringBuilder("{\"columns\":[");
        for (int index = 1; index <= columns; index++) {
            if (index > 1) output.append(',');
            output.append(escape(metadata.getColumnLabel(index)));
        }
        output.append("],\"rows\":[");
        long skipped = 0;
        while (skipped < offset && rows.next()) skipped++;
        int count = 0;
        boolean truncated = false;
        while (rows.next()) {
            if (count == rowLimit) { truncated = true; break; }
            if (count++ > 0) output.append(',');
            output.append('[');
            for (int index = 1; index <= columns; index++) {
                if (index > 1) output.append(',');
                output.append(value(rows.getObject(index)));
                if (output.length() > MAX_OUTPUT / 4) throw new SQLException("JDBC-Ergebnis überschreitet das Byte-Limit. Weniger Zeilen oder Spalten auswählen.");
            }
            output.append(']');
        }
        return output.append("],\"rows_affected\":").append(changes < 0 ? "null" : changes)
            .append(",\"execution_time_ms\":").append((System.nanoTime() - started) / 1000000)
            .append(",\"truncated\":").append(truncated).append('}').toString();
    }

    static String quote(String identifier) throws Exception {
        String quote = connection.getMetaData().getIdentifierQuoteString().trim();
        if (quote.isEmpty()) {
            if (!identifier.matches("[A-Za-z_][A-Za-z0-9_]*")) throw new SQLException("Treiber unterstützt keine zitierten Bezeichner.");
            return identifier;
        }
        return quote + identifier.replace(quote, quote + quote) + quote;
    }

    static String qualified(String schema, String table) throws Exception {
        return schema.isEmpty() || schema.equals("$default") ? quote(table) : quote(schema) + "." + quote(table);
    }

    static String nullable(String text) { return text.isEmpty() || text.equals("$default") ? null : text; }

    static String handle(String[] fields) throws Exception {
        long started = System.nanoTime();
        String operation = fields[0];
        if (operation.equals("open")) {
            if (connection != null) connection.close();
            Class.forName(fields[1]);
            Properties properties = new Properties();
            if (!fields[3].isEmpty()) properties.setProperty("user", fields[3]);
            if (!fields[4].isEmpty()) properties.setProperty("password", fields[4]);
            DriverManager.setLoginTimeout(15);
            connection = DriverManager.getConnection(fields[2], properties);
            connection.setAutoCommit(true);
            if (Boolean.parseBoolean(fields[5])) connection.setReadOnly(true);
            return "{\"ok\":true}";
        }
        if (connection == null) throw new SQLException("JDBC-Verbindung ist nicht geöffnet.");
        if (operation.equals("ping")) return "{\"ok\":" + connection.isValid(5) + "}";
        rowLimit = Math.max(1, Math.min(50000, Integer.parseInt(fields[1])));
        timeout = Math.max(1, Math.min(300, Integer.parseInt(fields[2])));
        DatabaseMetaData metadata = connection.getMetaData();
        ResultSet rows = null;
        Statement statement = null;
        long offset = 0;
        try {
            switch (operation) {
                case "catalogs": rows = metadata.getCatalogs(); break;
                case "schemas":
                    try { rows = metadata.getSchemas(); }
                    catch (SQLFeatureNotSupportedException | AbstractMethodError error) {
                        return "{\"columns\":[\"TABLE_SCHEM\"],\"rows\":[],\"rows_affected\":null,\"execution_time_ms\":0,\"truncated\":false}";
                    }
                    break;
                case "tables":
                case "views":
                    rows = metadata.getTables(connection.getCatalog(), nullable(fields[3]), "%", new String[]{operation.equals("views") ? "VIEW" : "TABLE"});
                    break;
                case "columns":
                    rows = metadata.getColumns(connection.getCatalog(), nullable(fields[3]), nullable(fields[4]), "%");
                    break;
                case "primary_keys": rows = metadata.getPrimaryKeys(connection.getCatalog(), nullable(fields[3]), fields[4]); break;
                case "fetch":
                case "count": {
                    String sql = operation.equals("count") ? "SELECT COUNT(*) FROM " : "SELECT * FROM ";
                    sql += qualified(fields[3], fields[4]);
                    if (!fields[5].isBlank()) sql += " WHERE " + fields[5];
                    if (operation.equals("fetch") && !fields[6].isEmpty()) sql += " ORDER BY " + quote(fields[6]) + (Boolean.parseBoolean(fields[7]) ? " DESC" : " ASC");
                    offset = operation.equals("fetch") ? Long.parseLong(fields[8]) : 0;
                    statement = connection.createStatement();
                    statement.setQueryTimeout(timeout);
                    statement.setMaxRows(operation.equals("count") ? 1 : (int) Math.min(Integer.MAX_VALUE, offset + rowLimit + 1L));
                    rows = statement.executeQuery(sql);
                    break;
                }
                case "query": {
                    PreparedStatement prepared = connection.prepareStatement(fields[3]);
                    statement = prepared;
                    prepared.setQueryTimeout(timeout);
                    prepared.setMaxRows(rowLimit + 1);
                    for (int index = 4; index < fields.length; index++) {
                        String parameter = fields[index];
                        if (parameter.equals("N")) prepared.setNull(index - 3, Types.NULL);
                        else prepared.setString(index - 3, parameter.substring(1));
                    }
                    if (prepared.execute()) rows = prepared.getResultSet();
                    else return "{\"columns\":[],\"rows\":[],\"rows_affected\":" + Math.max(0, prepared.getLargeUpdateCount()) + ",\"execution_time_ms\":" + ((System.nanoTime()-started)/1000000) + ",\"truncated\":false}";
                    break;
                }
                default: throw new SQLException("Unbekannte JDBC-Operation.");
            }
            return result(rows, -1, started, offset);
        } finally {
            if (rows != null) rows.close();
            if (statement != null) statement.close();
        }
    }

    static String readLine(InputStream input) throws IOException {
        ByteArrayOutputStream result = new ByteArrayOutputStream();
        for (int value; (value = input.read()) != -1;) {
            if (value == '\n') return result.toString(StandardCharsets.UTF_8);
            if (result.size() >= MAX_INPUT) throw new IOException("JDBC-Anfrage überschreitet 2 MiB.");
            result.write(value);
        }
        return result.size() == 0 ? null : result.toString(StandardCharsets.UTF_8);
    }

    public static void main(String[] args) throws Exception {
        System.setOut(new PrintStream(OutputStream.nullOutputStream()));
        try {
            for (String line; (line = readLine(System.in)) != null;) {
                try {
                    String[] fields = line.split("\\t", -1);
                    if (fields.length > 4096) throw new IOException("Zu viele JDBC-Parameter.");
                    for (int index = 0; index < fields.length; index++) fields[index] = new String(Base64.getDecoder().decode(fields[index]), StandardCharsets.UTF_8);
                    String response = handle(fields);
                    if (response.getBytes(StandardCharsets.UTF_8).length > MAX_OUTPUT) throw new IOException("JDBC-Ergebnis ist zu groß.");
                    OUTPUT.println(response);
                } catch (Throwable error) {
                    String state = error instanceof SQLException ? ((SQLException) error).getSQLState() : null;
                    String kind = "protocol";
                    if (error instanceof SQLException) {
                        kind = "sql";
                        if (error instanceof SQLTimeoutException || "57014".equals(state)) kind = "timeout";
                        else if (error instanceof SQLNonTransientConnectionException || error instanceof SQLTransientConnectionException || error instanceof SQLRecoverableException || (state != null && state.startsWith("08"))) kind = "connection";
                    }
                    OUTPUT.println("{\"error\":\"JDBC-Operation fehlgeschlagen\",\"kind\":" + escape(kind) + ",\"state\":" + (state == null ? "null" : escape(state)) + "}");
                }
                OUTPUT.flush();
            }
        } finally {
            if (connection != null) connection.close();
        }
    }
}
