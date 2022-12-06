
enum datetime_convert_dir {
	TIME_TO_STR
	STR_TO_TIME
	TIME_TO_BYTESTR
	BYTESTR_TO_TIME
	STR_TO_BYTESTR
	BYTESTR_TO_STR
};

enum en_datetime_rdwr {
	TIME_GET=0,
	TIME_SET
};

extern en_td_timezones datetime_tz_offset;
extern ok_ng datetime_convert_err;
extern ok_ng datetime_format_err;

struct crontab {
	string<10> minute;
	string<10> hour;
	string<10> day;//day of month
	string<10> month;
	string<12> day_of_week;
	unsigned long next_timestamp;
};

unsigned long datetime_to_timestamp(unsigned int days, unsigned int mins, unsigned char secs);
unsigned long datetime_current_timestamp();
unsigned long datetime_str_to_timestamp(string *datestr, string *format);
unsigned long datetime_next_cron(crontab next_cron);
string datetime_timestamp_to_string(unsigned long timestamp, string *format);
void datetime_from_timestamp(unsigned long timestamp, unsigned int *days, unsigned int *mins, unsigned char *secs);
void datetime_type_convert(string<14> *ts_str, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *bSec, datetime_convert_dir convert_dir);
void datetime_string_format(string<14> *result, string<14> *format, unsigned int *time_daycount, unsigned int *time_mincount, unsigned char *time_second_byte);
	
	
	
	