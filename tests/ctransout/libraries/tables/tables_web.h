
void tbl_web_start();
void tbl_web_set(string *tbl_name, no_yes tbl_enabled);
void tbl_web_get_tables(string *selected_type);
void tbl_web_get_rows(string *table);
string tbl_web_delete_row(string *table, unsigned int row);
string tbl_web_edit_row(string *table, unsigned int *index, string *row);
string tbl_web_get_field_def(string *table_name_or_num, string *field_name);
string tbl_web_get_url_params(string *http_req_string, string *argument);
string tbl_web_add_row(string *table, string *row);
string tbl_web_clear_table(string *table);