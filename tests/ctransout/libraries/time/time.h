//***********************************************************************************************************
//			DATE/TIME LIBRARY
//***********************************************************************************************************

enum en_td_string_ops {
	TD_STR_ADD_FORMATTING,
	TD_STR_REMOVE_FORMATTING
};

enum en_td_timezones {
	TD_TIMEZONE_GMT_MINUS_12_00,
	TD_TIMEZONE_GMT_MINUS_11_00,
	TD_TIMEZONE_GMT_MINUS_10_00,
	TD_TIMEZONE_GMT_MINUS_09_00,
	TD_TIMEZONE_GMT_MINUS_08_00,
	TD_TIMEZONE_GMT_MINUS_07_00,
	TD_TIMEZONE_GMT_MINUS_06_00,
	TD_TIMEZONE_GMT_MINUS_05_00,
	TD_TIMEZONE_GMT_MINUS_04_30,
	TD_TIMEZONE_GMT_MINUS_04_00,
	TD_TIMEZONE_GMT_MINUS_03_30,
	TD_TIMEZONE_GMT_MINUS_03_00,
	TD_TIMEZONE_GMT_MINUS_02_00,
	TD_TIMEZONE_GMT_MINUS_01_00,
	TD_TIMEZONE_GMT,
	TD_TIMEZONE_GMT_PLUS_01_00,
	TD_TIMEZONE_GMT_PLUS_02_00,
	TD_TIMEZONE_GMT_PLUS_03_00,
	TD_TIMEZONE_GMT_PLUS_03_30,
	TD_TIMEZONE_GMT_PLUS_04_00,
	TD_TIMEZONE_GMT_PLUS_04_30,
	TD_TIMEZONE_GMT_PLUS_05_00,
	TD_TIMEZONE_GMT_PLUS_05_30,
	TD_TIMEZONE_GMT_PLUS_05_45,
	TD_TIMEZONE_GMT_PLUS_06_00,
	TD_TIMEZONE_GMT_PLUS_06_30,
	TD_TIMEZONE_GMT_PLUS_07_00,
	TD_TIMEZONE_GMT_PLUS_08_00,
	TD_TIMEZONE_GMT_PLUS_09_00,
	TD_TIMEZONE_GMT_PLUS_09_30,
	TD_TIMEZONE_GMT_PLUS_10_00,
	TD_TIMEZONE_GMT_PLUS_11_00,
	TD_TIMEZONE_GMT_PLUS_12_00,
	TD_TIMEZONE_GMT_PLUS_13_00
};

enum en_td_date_formats {
	TD_DATE_FORMAT_YYYYMMDD,
	TD_DATE_FORMAT_MMDDYYYY,
	TD_DATE_FORMAT_DDMMYYYY
};

//------------------------------------------------------------------------------
void td_get_tzone_offset(en_td_timezones timezone, unsigned int *minutes_offset);
ok_ng td_gmt_to_local(unsigned int *day_count, unsigned int *min_count, en_td_timezones timezone, off_on dst);
ok_ng td_local_to_gmt(unsigned int *day_count, unsigned int *min_count, en_td_timezones timezone, off_on dst);
ok_ng td_to_str(string *td_str, unsigned int day_count, unsigned int min_count, unsigned char seconds, unsigned int mseconds);
ok_ng td_from_str(string *td_str, unsigned int *day_count, unsigned int *min_count, unsigned char *seconds, unsigned int *mseconds);
ok_ng td_to_binstr(string *td_str, unsigned int day_count, unsigned int min_count, unsigned char seconds, unsigned int mseconds);
ok_ng td_from_binstr(string *td_str, unsigned int *day_count, unsigned int *min_count, unsigned char *seconds, unsigned int *mseconds);
ok_ng td_str_to_binstr(string *td_str);
ok_ng td_binstr_to_str(string *td_str);
ok_ng td_str_date_time_reformat(string *td_str, en_td_string_ops op, en_td_date_formats date_format);
ok_ng td_str_time_reformat(string *t_str, en_td_string_ops op);
