
#include "global.th"

string<TBL_MAX_TABLE_NAME_LEN> tbl_web_enabled_tables[TBL_MAX_NUM_TABLES];
en_tbl_status_codes tbl_web_tbl_status;

void tbl_web_start() {
	unsigned char i;
	for (i=0; i <= TBL_MAX_NUM_TABLES-1; i++) {
		tbl_web_enabled_tables[i] = "";
	}
}

void tbl_web_set(string *tbl_name, no_yes tbl_enabled) {
	unsigned char i;
	for (i=0; i <= TBL_MAX_NUM_TABLES-1; i++) {
		if (tbl_enabled == YES && tbl_web_enabled_tables[i] == "") {
			tbl_web_enabled_tables[i] = *tbl_name;
			return;
		} else if (tbl_enabled == NO && tbl_web_enabled_tables[i] == *tbl_name) {
			tbl_web_enabled_tables[i] = "";
			return;
		}
	}
}


void tbl_web_get_tables(string *selected_type) {
	unsigned char i, j;
	string<TBL_MAX_TABLE_NAME_LEN> table_name;
	tbl_type html_tbl;
	unsigned char num_of_fld;
	unsigned int tbl_rows;
	string<5> table_type = "table";
	tbl_field_type field_metadata;

	if (TBL_MAX_NUM_TABLES == 0) {
		return;
	}
	for (i=0; i <= TBL_MAX_NUM_TABLES-1; i++) {
		if (tbl_web_enabled_tables[i] != "") {
			table_name = tbl_web_enabled_tables[i];
			tbl_web_tbl_status = tbl_select(table_name,table_name);
			if (tbl_web_tbl_status == EN_TBL_STATUS_OK) {
				if (tbl_get_table_info(table_name,html_tbl) == EN_TBL_STATUS_OK) {
					if (html_tbl.struct == EN_TBL_STRUCT_TABLE) {
						table_type = "table";
					} else {
						table_type = "log";
					}
					if (*selected_type == table_type) {
						sock.setdata(table_name+"|");
						sock.setdata(table_type+"|");
						tbl_get_num_records(tbl_rows,NO);
						sock.setdata(str(tbl_rows)+"|");
						//fieldName|rowCount|column1|column2|....\r\n
						num_of_fld = tbl_get_num_fields(table_name);
						for (j=0; j <= num_of_fld-1; j++) {
							tbl_get_field_info(table_name,j,field_metadata);
							sock.setdata(field_metadata.field_name+",");
							sock.setdata(chr(field_metadata.field_type)+",");
							sock.setdata(str(field_metadata.p1)+",");
							sock.setdata(str(field_metadata.p2)+",");
							sock.setdata(str(field_metadata.key)+",");
							sock.setdata(str(field_metadata.romaddr_def)+",");
							string df;
							tbl_get_field_def(table_name,field_metadata.field_name,df);
							sock.setdata(df);
							if (j<num_of_fld-1) {
								sock.setdata("|");
							}
							sock.send();
						}
						sock.setdata("\r\n");
					}
				}
			}

		}
	}
}

string tbl_web_get_url_params(string *http_req_string, string *argument) {
string tbl_web_get_url_params;
	unsigned char x, y;
	x == instr(1,*http_req_string,*argument+"=",1);
	if ((x == 0)) {
		tbl_web_get_url_params = "";
		return tbl_web_get_url_params;
	}
	x == x+len(*argument+"=");
	y = instr(x,*http_req_string,"&",1);
	if ((y == 0)) {
		y = instr(x,*http_req_string," ",1);
		if ((y == 0)) {
			y == len(*argument+"=");
		}
	}
	tbl_web_get_url_params = mid(*http_req_string,x,y-x);
	return tbl_web_get_url_params;
}

void tbl_web_get_rows(string *table) {
	unsigned int i;
	unsigned char j, num_of_fld;
	string fld_data;
	string<TBL_MAX_FIELD_NAME_LEN> fld_name;
	tbl_type html_tbl;
	unsigned int tbl_rows, tbl_rows_all;
	unsigned int row_max;
	tbl_field_type field_metadata;
	bool initialized = false;
	string fields[TBL_MAX_TOTAL_NUM_FIELDS];
	string tmp_data = "";

	tbl_select(*table,*table);

	if (tbl_get_table_info(*table,html_tbl) == EN_TBL_STATUS_OK) {
		tbl_get_num_records(tbl_rows,NO);
		tbl_get_num_records(tbl_rows_all,YES);
		tmp_data = str(tbl_rows)+"\r\n";
		while (sock.txfree<len(tmp_data)) {
			doevents;
		}
		sock.setdata(tmp_data);
		sock.send();
		row_max = tbl_rows_all;
		if (row_max>tbl_rows) {
			row_max = tbl_rows;
		}

		num_of_fld = tbl_get_num_fields(*table);

		if (tbl_rows_all == 0) {
			return;
		}
		for (i=1; i <= tbl_rows_all; i++) {
			if (tbl_rows_all == 0) {
				break;
			}
			if (tbl_is_record_deleted(i) != YES) {
				tbl_record_sg(i,EN_TBL_GET);
				tmp_data = str(i)+",";
				for (j=0; j <= num_of_fld-1; j++) {
					if (initialized == false) {
						tbl_get_field_info(*table,j,field_metadata);
						fld_name = field_metadata.field_name;
						fields[j] = fld_name;
					}
					tbl_field_sg(fields[j],fld_data,EN_TBL_GET);
					tmp_data = tmp_data+fld_data;
					if (j<num_of_fld-1) {
						tmp_data = tmp_data+",";
					} else {
						tmp_data = tmp_data+"\r\n";
					}
					while (sock.txfree<len(tmp_data)) {
						doevents;
					}
					sock.setdata(tmp_data);
					sock.send();
					tmp_data = "";
				}
				initialized = true;
			}

		}
	}
}

string tbl_web_add_row(string *table, string *row) {
string tbl_web_add_row;
//field1,field2,field3,etc.
	tbl_type html_tbl;
	tbl_field_type field_metadata;
	unsigned char i, j, pos1, pos2, num_of_fld;
	struct_tbl_timestamp ts;
	string s;
	string error;
	string<16> stemp;
	tbl_web_add_row = "";

	tbl_select(*table,*table);
	tbl_web_tbl_status = tbl_get_table_info(*table,html_tbl);
	if (tbl_web_tbl_status == EN_TBL_STATUS_OK) {
		num_of_fld = tbl_get_num_fields(*table);
		pos1 = 1;
		for (i=0; i <= num_of_fld-1; i++) {
			tbl_get_field_info(*table,i,field_metadata);
//			if i>0 then
//				pos1=instr(pos1,row,",",i)
//			end if
			pos2 = instr(pos1,*row,",",1);
			s = mid(*row,pos1,pos2-pos1);
			if (s == "") {
				tbl_web_tbl_status = tbl_get_field_def(*table,field_metadata.field_name,s);
				if (tbl_web_tbl_status != EN_TBL_STATUS_OK) { goto verify;}
			}
			tbl_web_tbl_status = tbl_field_sg(field_metadata.field_name,s,EN_TBL_SET);
			if (tbl_web_tbl_status != EN_TBL_STATUS_OK) { goto verify;}
			pos1 = pos2+1;
		}

		tbl_web_tbl_status = tbl_record_add(stemp);
	}

verify: 
	switch (tbl_web_tbl_status) {
	case EN_TBL_STATUS_FULL:

		error = "Max record number reached or disk is full";
		break;
	case EN_TBL_STATUS_KEY_VIOLATION:

		error = "Key field violation";
		break;
	case EN_TBL_STATUS_INVALID:

		error = "Field value invalid";
		break;
	case EN_TBL_STATUS_OK:

		error = "";
#if PLATFORM_ID  !=  EM500W && PLATFORM_ID  !=  EM510W
		rtc.getdata(ts.ts_daycount,ts.ts_mincount,ts.ts_seconds);
#endif
		ts.ts_milsec = 999;
		tbl_timestamp_sg(ts,EN_TBL_SET);
		break;
	default:
		error = str(tbl_web_tbl_status);break;
	}
	tbl_web_add_row = error;

return tbl_web_add_row;
}

string tbl_web_get_field_def(string *table_name_or_num, string *field_name) {
string tbl_web_get_field_def;
	string error = "";
	string def_value;
	tbl_web_tbl_status = tbl_get_field_def(*table_name_or_num,*field_name,def_value);
	if (tbl_web_tbl_status == EN_TBL_STATUS_OK) {
		tbl_web_get_field_def = def_value;
	} else {
		switch (tbl_web_tbl_status) {
		case EN_TBL_STATUS_INVALID:

			error = "Field value invalid";
			break;
		default:
			error = str(tbl_web_tbl_status);break;
		}
		tbl_web_get_field_def = error;
	}
	return tbl_web_get_field_def;
}

string tbl_web_delete_row(string *table, unsigned int row) {
string tbl_web_delete_row;
	tbl_type html_tbl;
	struct_tbl_timestamp ts;
	string error = "";
	string<16> stemp;

	tbl_select(*table,*table);
	tbl_web_tbl_status = tbl_get_table_info(*table,html_tbl);
	if (tbl_web_tbl_status == EN_TBL_STATUS_OK) {
		tbl_record_delete(row);
	}


	switch (tbl_web_tbl_status) {
	case EN_TBL_STATUS_FULL:

		error = "Max record number reached or disk is full";
		break;
	case EN_TBL_STATUS_KEY_VIOLATION:

		error = "Key field violation";
		break;
	case EN_TBL_STATUS_INVALID:

		error = "Field value invalid";
		break;
	case EN_TBL_STATUS_OK:

		error = "";
#if PLATFORM_ID  !=  EM500W && PLATFORM_ID  !=  EM510W
		rtc.getdata(ts.ts_daycount,ts.ts_mincount,ts.ts_seconds);
#endif
		ts.ts_milsec = 999;
		tbl_timestamp_sg(ts,EN_TBL_SET);
		break;
	default:
		error = str(tbl_web_tbl_status);break;
	}
	tbl_web_delete_row = error;

return tbl_web_delete_row;
}

string tbl_web_edit_row(string *table, unsigned int *index, string *row) {
string tbl_web_edit_row;
	//field1,field2,field3,etc.
	tbl_type html_tbl;
	tbl_field_type field_metadata;
	unsigned char i, j, pos1, pos2, num_of_fld;
	struct_tbl_timestamp ts;
	string s;
	string error;
	string<16> stemp;
	tbl_web_edit_row = "";

	tbl_select(*table,*table);
	tbl_web_tbl_status = tbl_get_table_info(*table,html_tbl);
	if (tbl_web_tbl_status == EN_TBL_STATUS_OK) {
		num_of_fld = tbl_get_num_fields(*table);
		pos1 = 1;
		tbl_record_sg(*index,EN_TBL_GET);
		for (i=0; i <= num_of_fld-1; i++) {
			tbl_get_field_info(*table,i,field_metadata);
//			if i>0 then
//				pos1=instr(pos1,row,",",i)
//			end if
			pos2 = instr(pos1,*row,",",1);
			s = mid(*row,pos1,pos2-pos1);
			if (s == "") {
				tbl_web_tbl_status = tbl_get_field_def(*table,field_metadata.field_name,s);
				if (tbl_web_tbl_status != EN_TBL_STATUS_OK) { goto verify;}
			}
			tbl_web_tbl_status = tbl_field_sg(field_metadata.field_name,s,EN_TBL_SET);
			if (tbl_web_tbl_status != EN_TBL_STATUS_OK) { goto verify;}
			pos1 = pos2+1;
		}

		tbl_web_tbl_status = tbl_record_edit(*index);
	}

verify: 
	switch (tbl_web_tbl_status) {
	case EN_TBL_STATUS_FULL:

		error = "Max record number reached or disk is full";
		break;
	case EN_TBL_STATUS_KEY_VIOLATION:

		error = "Key field violation";
		break;
	case EN_TBL_STATUS_INVALID:

		error = "Field value invalid";
		break;
	case EN_TBL_STATUS_OK:

		error = "";
#if PLATFORM_ID  !=  EM500W && PLATFORM_ID  !=  EM510W
		rtc.getdata(ts.ts_daycount,ts.ts_mincount,ts.ts_seconds);
#endif		
		ts.ts_milsec = 999;
		tbl_timestamp_sg(ts,EN_TBL_SET);
		break;
	default:
		error = str(tbl_web_tbl_status);break;
	}
	tbl_web_edit_row = error;
	return tbl_web_edit_row;
}

string tbl_web_clear_table(string *table) {
string tbl_web_clear_table;
	string error;

	tbl_select(*table,*table);
	tbl_web_tbl_status = tbl_clear();
	switch (tbl_web_tbl_status) {
	case EN_TBL_STATUS_FULL:

		error = "Max record number reached or disk is full";
		break;
	case EN_TBL_STATUS_KEY_VIOLATION:

		error = "Key field violation";
		break;
	case EN_TBL_STATUS_INVALID:

		error = "Field value invalid";
		break;
	case EN_TBL_STATUS_OK:

		error = "";
		break;
	default:
		error = str(tbl_web_tbl_status);break;
	}
	tbl_web_clear_table = error;

return tbl_web_clear_table;
}