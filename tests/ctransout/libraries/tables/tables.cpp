//***********************************************************************************************************
//			TABLES LIBRARY
//***********************************************************************************************************

#include "global.th"

//------------------------------------------------------------------------------
#define TBL_DELETE_FLAG chr(val("0xFF"))
#define TBL_ACTIVE_FLAG chr(val("0xFE"))
#define TBL_NULL 0
#define TBL_FIELD_SEPARATOR 9
#define TBL_STAMP "TBL> "
#define TBL_CR_LF chr(13)+chr(10)
#define TBL_ELEMENT_START 28
#define TBL_ELEMENT_END 29
#define TBL_ELEMENT_NAME_VALUE_SEPARATOR 30
#define TBL_INIT_SIGNATURE 0x54F1

#if TBL_AGGREGATE_HASH
	#if TBL_MAX_RECORD_SIZE>9
		#define TBL_MAX_FIELD_VALUE_LEN TBL_MAX_RECORD_SIZE-9
	#else
		#define TBL_MAX_FIELD_VALUE_LEN 0
	#endif
#else
	#if TBL_MAX_RECORD_SIZE>1
		#define TBL_MAX_FIELD_VALUE_LEN TBL_MAX_RECORD_SIZE-1
	#else
		#define TBL_MAX_FIELD_VALUE_LEN 0
	#endif
#endif

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_info_find(string *table_name_or_num, unsigned char *index);
no_yes tbl_check_key_violation(unsigned int *key_ptr);
en_tbl_status_codes tbl_field_find(string field_name, unsigned int *field_index);
en_tbl_status_codes tbl_generate_uid(string *id_string);
string tbl_get_descriptor_field(unsigned int line_end_pos, unsigned int *field_start_pos);
en_tbl_status_codes tbl_adjust_size();
pl_fd_status_codes tbl_attributes_sg(string *tbl_file_name, string<4> attri_name, string *attri_val, en_tbl_rdwr op);
pl_fd_status_codes tbl_active_rc_sg(unsigned int *rec_count, en_tbl_rdwr op);
unsigned char tbl_get_field_size(unsigned int field_index);
en_tbl_status_codes tbl_record_ptr_sg(unsigned int *rec_num, en_tbl_rdwr op);
void tbl_check_for_missing_fields(unsigned int curr_pos, unsigned int line_end_pos);
void tbl_debug_print_error(string *debug_str, en_tbl_status_codes status_code);
void tbl_debugprint(string *print_data);
void tbl_mod_hash(unsigned long *d);

#if TBL_AGGREGATE_HASH
	unsigned long tbl_set_md5();
#endif

//------------------------------------------------------------------------------
unsigned char tbl_info_index;
unsigned char tbl_fld_offset;
string<TBL_MAX_RECORD_SIZE> tbl_record_string;
string<TBL_MAX_FILE_NAME_LEN> tbl_selected_file_name;
tbl_type(TBL_MAX_NUM_TABLES) tbl_info;
tbl_field_type(TBL_MAX_TOTAL_NUM_FIELDS) tbl_field_info;
unsigned int tbl_selected_active_rc;
unsigned int tbl_selected_all_rc;
unsigned int tbl_init_flag;

#if TBL_DEBUG_PRINT
	no_yes tbl_do_not_debug_print;
#endif

//==============================================================================
en_tbl_status_codes tbl_start() {
en_tbl_status_codes tbl_start;
//API procedure, starts the table library, parses the descriptor file, checks compilation options, and exams the memory usage.
//Also mounts flash disk

	string s;
	unsigned int i, j, k, line_end, field_start_pos, num_fields;
	unsigned long dw;
	unsigned char b, record_size;
	unsigned char max_tbl_name_len, max_fld_name_len, max_record_size;
	tbl_type tbl_item;
	tbl_field_type field_item;
	unsigned int field_index;
	long p1, p2;

	tbl_start = EN_TBL_STATUS_OK;

	#if TBL_DEBUG_PRINT
		tbl_do_not_debug_print = NO;
	#endif

	#if TBL_DEBUG_PRINT
		tbl_debugprint("---START---");
	#endif

	if (TBL_MAX_TABLE_NAME_LEN == 0 || TBL_MAX_TABLE_NAME_LEN>26) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: TBL_MAX_TABLE_NAME_LEN must be between 1 and 26, you now have '#TBL_MAX_TABLE_NAME_LEN "+str(TBL_MAX_TABLE_NAME_LEN)+"'.");
		#endif
		tbl_info_index = 0;
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}

	if (TBL_MAX_FILE_NAME_LEN == 0 || TBL_MAX_FILE_NAME_LEN>42) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: TBL_MAX_FILE_NAME_LEN must be between 1 and 42, you now have '#TBL_MAX_FILE_NAME_LEN "+str(TBL_MAX_FILE_NAME_LEN)+"'.");
		#endif
		tbl_info_index = 0;
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}

	if (TBL_MAX_NUM_TABLES == 0 || TBL_MAX_NUM_TABLES>255) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: TBL_MAX_NUM_TABLES must be between 1 and 255, you now have '#TBL_MAX_NUM_TABLES "+str(TBL_MAX_NUM_TABLES)+"'.");
		#endif
		tbl_info_index = 0;
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}

	if (TBL_MAX_FIELD_NAME_LEN == 0 || TBL_MAX_FIELD_NAME_LEN>32) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: TBL_MAX_FIELD_NAME_LEN must be between 1 and 32, you now have '#TBL_MAX_FIELD_NAME_LEN "+str(TBL_MAX_FIELD_NAME_LEN)+"'.");
		#endif
		tbl_info_index = 0;
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}

	if (TBL_MAX_TOTAL_NUM_FIELDS == 0 || TBL_MAX_TOTAL_NUM_FIELDS>65535) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: TBL_MAX_TOTAL_NUM_FIELDS must be between 1 and 65535, you now have '#TBL_MAX_TOTAL_NUM_FIELDS "+str(TBL_MAX_TOTAL_NUM_FIELDS)+"'.");
		#endif
		tbl_info_index = 0;
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}

	switch (TBL_MAX_RECORD_SIZE) {
	case 2:
case 4:
case 8:
case 16:
case 32:
case 64:
case 128:

	break;
		//---

	default:
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: TBL_MAX_RECORD_SIZE must be equal to 2,4,8,16,32,64, or 128, you now have '#TBL_MAX_RECORD_SIZE "+str(TBL_MAX_RECORD_SIZE)+"'.");
		#endif
		tbl_info_index = 0;
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;break;
	}

	if (TBL_MAX_FIELD_VALUE_LEN == 0) {
		#if TBL_DEBUG_PRINT
			#if TBL_AGGREGATE_HASH
				tbl_debugprint("ERROR: TBL_MAX_RECORD_SIZE is too small, You need to increase TBL_MAX_RECORD_SIZE to at least 16.");
			#else
				tbl_debugprint("ERROR: TBL_MAX_RECORD_SIZE is too small, You need to increase TBL_MAX_RECORD_SIZE to at least 2.");
			#endif
		#endif
		tbl_info_index = 0;
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}

	if (fd.ready == NO) {
		if (fd.mount()) {
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR: the flash disk is not formatted or malfunctioned.");
			#endif
			tbl_start = EN_TBL_STATUS_FAILURE;
			return tbl_start;
		}
		if (fd.transactioncapacityremaining<16) {
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR: Current flash disk formatting doesn't support transactions. Use 'fd.formatj()' with maxjournalsectors>=16 (currently "+str(fd.transactioncapacityremaining)+").");
			#endif
			tbl_start = EN_TBL_STATUS_INV_PARAM;
			return tbl_start;
		}
	}

	num_fields = 0;
	max_tbl_name_len = 0;
	max_fld_name_len = 0;
	max_record_size = 0;
	tbl_fld_offset = 0;
	#if TBL_AGGREGATE_HASH
		tbl_fld_offset = tbl_fld_offset+2;
	#endif

	s = strgen(TBL_MAX_RECORD_SIZE-1,chr(TBL_NULL));
	tbl_record_string = TBL_ACTIVE_FLAG+s;
	tbl_info_index = 0;//will select table_info array member (follows table_num_tables but is limited by array size)
	tbl_selected_file_name = "";
	field_index = 0;//total number of fields (for all tables)	

	romfile.open(TBL_DESCRIPTOR_FILE);//this file is a table descriptor file
	if (romfile.size == 0) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: '"+TBL_DESCRIPTOR_FILE+"' is not in your project or file is empty.");
		#endif
		tbl_info_index = 0;//table descriptor file is not in your project (or file is empty)
		tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
		return tbl_start;
	}

	i == romfile.find(romfile.pointer,"==",1);
	while (i != 0) {
		//we are now at the "==" pointing at the beginning of one table descriptor line
		romfile.pointer = i+2;

		//find the end of this table descriptor line
		line_end = romfile.find(romfile.pointer,TBL_CR_LF,1);
		if (line_end == 0) {
			line_end = romfile.size+1;
		}

		//extract table name
		s = tbl_get_descriptor_field(line_end,field_start_pos);
		if (s == "") {
			//missing table name field
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table #"+str(tbl_info_index)+"'): missing table name field (tables are counted from 0).");
			#endif
			tbl_info_index = 0;
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;
		}

		if (len(s)>TBL_MAX_TABLE_NAME_LEN) {
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table '"+s+"'): this table's name length is "+str(len(s))+", while you have 'TBL_MAX_TABLE_NAME_LEN "+str(TBL_MAX_TABLE_NAME_LEN)+"'.");
			#endif
			tbl_info_index = 0;//you need to increase TBL_MAX_TABLE_NAME_LEN!
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;
		}
		if (len(s)>max_tbl_name_len) { max_tbl_name_len = len(s);}
		tbl_item.table_name = s;

		//extract the maximum number of records
		s = tbl_get_descriptor_field(line_end,field_start_pos);

		if (s == "") {
			//missing missing maximum number field
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): missing maximum number of records field.");
			#endif
			tbl_info_index = 0;
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;
		}

		if (lval(s)>65535) {
			//exceeded max possible number of records
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): maximum number of records cannot exceed 65535, you now have "+lstr(lval(s))+".");
			#endif
			tbl_info_index = 0;
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;
		}
		tbl_item.maxrecs = val(s);

		//extract the table type
		s = tbl_get_descriptor_field(line_end,field_start_pos);
		if (s == "") {
			//missing table type field
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): missing table type field.");
			#endif
			tbl_info_index = 0;
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;
		}
		switch (s) {
		case "L":
tbl_item.struct = EN_TBL_STRUCT_LIST;
		break;
		case "T":
tbl_item.struct = EN_TBL_STRUCT_TABLE;
		break;
		default:
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): unknown table type'"+s+"', use 'T' or 'L' only.");
			#endif
			tbl_info_index = 0;//change table type field to either "L" or "T"
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;break;
		}

		//extract number of key fields
		s = tbl_get_descriptor_field(line_end,field_start_pos);
		if (s == "") {
			//missing number of key fields
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): missing number of key fields.");
			#endif
			tbl_info_index = 0;
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;
		}

		if (val(s)>TBL_MAX_TOTAL_NUM_FIELDS) {
			//exceeded max possible number of key fields
			#if TBL_DEBUG_PRINT
				tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): maximum number of fields (and key fields) cannot exceed TBL_MAX_TOTAL_NUM_FIELDS, now "+str(TBL_MAX_TOTAL_NUM_FIELDS)+". Number of key fields is currently "+s+".");
			#endif
			tbl_info_index = 0;
			tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
			return tbl_start;
		}
		tbl_item.numkeyf = val(s);

		record_size = 1;//active flag is 1 byte long
		i == romfile.find(romfile.pointer,"==",1);//looking for the addr for the next table.
		j = romfile.find(romfile.pointer,">>",1);//looking for the addr of the first field of current table

		if (i != 0 && i<j) { goto no_field_found;}

		tbl_item.field_num_offset = field_index;
		#if TBL_AGGREGATE_HASH
			field_item.field_name = "MD5";
			field_item.field_type = asc("U");
			field_item.key = no;
			field_item.p1 = 0;
			field_item.p2 = 4294967295;
			field_item.romaddr_def = 0;
			record_size = record_size+4;
			if (field_index<TBL_MAX_TOTAL_NUM_FIELDS) {
				tbl_field_info[field_index] = field_item;
			}
			field_index = field_index+1;

			field_item.field_name = "UID";
			field_item.field_type = asc("U");
			field_item.key = yes;
			field_item.p1 = 0;
			field_item.p2 = 2147483647;
			field_item.romaddr_def = 0;
			record_size = record_size+4;
			if (field_index<TBL_MAX_TOTAL_NUM_FIELDS) {
				tbl_field_info[field_index] = field_item;
			}
			field_index = field_index+1;
		#endif

		//addr of the fields for current table should not exceed the addr of the next table, unless the current table is the last table
		while ((j != 0 && j<i) || (i == 0 && j>0)) {
			romfile.pointer = j+2;

			//find the end of this field descriptor line
			line_end = romfile.find(romfile.pointer,TBL_CR_LF,1);
			if (line_end == 0) {
				line_end = romfile.size+1;
			}

			//extract field name
			s = tbl_get_descriptor_field(line_end,field_start_pos);
			if (s == "") {
				//missing field name field
				#if TBL_DEBUG_PRINT
					tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field #"+str(field_index-num_fields)+"): missing field name (fields are counted from 0).");
				#endif
				field_index = 0;
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;
			}

			if (len(s)>TBL_MAX_FIELD_NAME_LEN) {
				#if TBL_DEBUG_PRINT
					tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+s+"'): this field's name length is "+str(len(s))+", while you have 'TBL_MAX_FIELD_NAME_LEN "+str(TBL_MAX_FIELD_NAME_LEN)+"'.");
				#endif
				field_index = 0;//you need to increase TBL_MAX_FIELD_NAME_LEN!
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;
			}
			if (len(s)>max_fld_name_len) { max_fld_name_len = len(s);}
			field_item.field_name = s;

			//extract field type
			s = tbl_get_descriptor_field(line_end,field_start_pos);

			if (s == "") {
				//missing field type
				#if TBL_DEBUG_PRINT
					tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): missing field type.");
				#endif
				field_index = 0;
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;
			}

			switch (s) {
			#if TBL_TIME_TYPE_INCLUDED
				case "S":
case "B":
case "W":
case "U":
case "T":
case "F":
case "E":
case "M":

				break;
			#else
				case "S":
case "B":
case "W":
case "U":
case "F":
case "E":
case "M":

				break;
			#endif
			default:
				#if TBL_TIME_TYPE_INCLUDED
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): unknown field type '"+s+"', use 'B','W','U', 'S', 'F','E','M', or 'T' only.");
					#endif
				#else
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): unknown field type '"+s+"', use 'B','W','U','F','E','M', or 'S' only.");
					#endif
				#endif
				field_index = 0;//change field type to 'S','B','W','U' or 'T'
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;break;
			}
			field_item.field_type = asc(s);

			//extract p1
			s = tbl_get_descriptor_field(line_end,field_start_pos);
			p1 = s;

			if (s == "") {
				//missing p1
				#if TBL_DEBUG_PRINT
					tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): missing P1 parameter field.");
				#endif
				field_index = 0;
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;
			}

			switch (field_item.field_type) {
			#if TBL_TIME_TYPE_INCLUDED			
				case `T`:

					if (val(s)>6) {
						#if TBL_DEBUG_PRINT
							tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): minimum value (P1 param) can't exceed 6 for date/time type. It is now "+s);
						#endif
						tbl_info_index = 0;
						tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
						return tbl_start;
					}
					break;
			#endif			
			case `B`:

				if (p1>255) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): minimum value (P1 param) can't exceed 255 for byte type. It is now "+s);
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `W`:

				if (p1>65535) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): minimum value (P1 param) can't exceed 65535 for word type. It is now "+s);
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `U`:

				if (p1>4294967295) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): minimum value (P1 param) can't exceed 4294967295 for dword type. It is now "+s);
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `S`:

				if (p1>TBL_MAX_FIELD_VALUE_LEN) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): minimum length (P1 param) exceed maximum string field length for this record, please decrease p1 or increase TBL_MAX_RECORD_SIZE.");
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `E`:
// Timestamp
				if (p1>2147483647) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): minimum value (P1 param) can't exceed 2147483647 for datetime type. It is now "+s);
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `M`:
// Time
				if (p1>1440) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): minimum value (P1 param) can't exceed 1440 for time type. It is now "+s);
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			}
			field_item.p1 = p1;

			//extract p2
			s = tbl_get_descriptor_field(line_end,field_start_pos);
			p2 = s;
			if (s == "") {
				//missing p2
				#if TBL_DEBUG_PRINT
					tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): missing P2 parameter field.");
				#endif
				field_index = 0;
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;
			}

			switch (field_item.field_type) {
			case `B`:

				if (p2>255) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): maximum value (P2 param) can't exceed 255 for byte type. It is now "+s);
					#endif
					field_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `W`:

				if (p2>65535) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): maximum value (P2 param) can't exceed 65535 for word type. It is now "+s);
					#endif
					field_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `U`:

				if (p2>4294967295) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): maximum value (P2 param) can't exceed 4294967295 for dword type. It is now "+s);
					#endif
					field_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			case `S`:

				if (val(s)>TBL_MAX_FIELD_VALUE_LEN) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): maximum length (P2 param) exceed maximum string field length for this record, please decrease p2 or increase TBL_MAX_RECORD_SIZE.");
					#endif
					field_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			}
			field_item.p2 = p2;

			if (field_item.p2<field_item.p1 && field_item.field_type != `T`) {
				#if TBL_DEBUG_PRINT
					tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): P2 parameter (now "+lstr(field_item.p2)+") cannot be smaller than P1 parameter (now "+lstr(field_item.p1)+").");
				#endif
				field_index = 0;//P2 parameter cannot be smaller than P1 parameter
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;
			}

			//extract default value field
			s = tbl_get_descriptor_field(line_end,field_start_pos);
			if (s == "") {
				//missing default value field
				#if TBL_DEBUG_PRINT
					tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): missing default value field (use '^' to specify NULL default value.).");
				#endif
				field_index = 0;
				tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
				return tbl_start;
			}

			//save default value field position
			field_item.romaddr_def = field_start_pos;

			//verify the validity of the default value
			switch (field_item.field_type) {
			case `U`:

				b = len(s);
				if (lval(s)>4294967295) {
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): maximum default value can't exceed 4294967295 for dword type. It is now "+s);
					#endif
					field_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				goto check_for_p1_p2;
				break;
			case `B`,`W`,`U`:

check_for_p1_p2: 
				if (s == "^") {
					dw = 0;
				} else {
					dw = lval(s);
				}
				if (dw<field_item.p1) {
					//def value < P1
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): default value is "+lstr(dw)+" which is below P1 parameter ("+lstr(field_item.p1)+").");
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				if (dw>field_item.p2) {
					//def value > P2
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): default value is "+lstr(dw)+" which is above P2 parameter ("+lstr(field_item.p2)+").");
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;

			case `S`:

				if (s == "^") {
					k = 0;
				} else {
					k = len(s);
				}

				if (k<field_item.p1) {
					//def value < P1
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): default value length is "+str(k)+" which is below P1 parameter ("+str(field_item.p1)+").");
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				if (k>field_item.p2) {
					//def value > P2
					#if TBL_DEBUG_PRINT
						tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): default value length is "+str(k)+" which is above P2 parameter ("+str(field_item.p2)+").");
					#endif
					tbl_info_index = 0;
					tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
					return tbl_start;
				}
				break;
			#if TBL_TIME_TYPE_INCLUDED
				case `T`:

					switch (field_item.p1) {
					case EN_TBL_DT_DATE:
//YYYYMMDD (year,month,date)
						s = s+"000000";
						break;
					case EN_TBL_DT_TIME1:
//hhmm (hour,minutes)
						s = "20000101"+s+"00";
						break;
					case EN_TBL_DT_TIME2:
//hhmmss (hour,minutes,second)
						s = "20000101"+s;
						break;
					case EN_TBL_DT_TIME3:
//hhmmssmls (hour,minutes,second,milsecond)
						s = "20000101"+left(s,6);
						break;
					case EN_TBL_DT_DATE_TIME1:
//YYYYMMDDhhmm (year,month,date,hour,minutes)
						s = s+"00";
						break;
					case EN_TBL_DT_DATE_TIME2:

					break;//YYYYMMDDhhmmss (year,month,date,hour,minutes,second)
					case EN_TBL_DT_ALL:
//YYYYMMDDhhmmssmls (year,month,date,hour,minutes,second,milsecond)
						s = left(s,14);
						break;
					}
					if (td_str_to_binstr(s) != OK) {
						//def value 
						#if TBL_DEBUG_PRINT
							tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): default value is "+s+" which is not a valid date/time string (YYYYMMDDhhmmssmls).");
						#endif
						tbl_info_index = 0;
						tbl_start = EN_TBL_STATUS_WRONG_DESCRIPTOR;
						return tbl_start;
					}
					break;
			#endif
			}

			if (field_index<TBL_MAX_TOTAL_NUM_FIELDS) {
				tbl_field_info[field_index] = field_item;
				k = tbl_get_field_size(field_index);
				if (k>TBL_MAX_FIELD_VALUE_LEN) {
					#if TBL_DEBUG_PRINT
						 tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'/field '"+field_item.field_name+"'): this field would occupy up to "+str(k)+" chars in string form, while you have 'TBL_MAX_FIELD_VALUE_LEN "+str(TBL_MAX_FIELD_VALUE_LEN)+"'.");
					#endif
					tbl_info_index = 0;//you need to increase TBL_MAX_RECORD_SIZE!
					tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
					return tbl_start;
				}
				record_size = record_size+k;
			}
			field_index = field_index+1;
			j = romfile.find(romfile.pointer,">>",1);
		}

		num_fields = field_index-tbl_item.field_num_offset;
		if (num_fields == 0) {
no_field_found: 
			#if TBL_DEBUG_PRINT
				 tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): No fields defined. There must be at least one field in each table.");
			#endif
			tbl_info_index = 0;//no field found
			tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
			return tbl_start;
		}

		if (tbl_item.numkeyf>num_fields) {
			#if TBL_DEBUG_PRINT
				 tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): the number of key fields ("+str(tbl_item.numkeyf)+") is greater than the number of fields ("+str(num_fields)+") in the table.");
			#endif
			tbl_info_index = 0;//number of key fields exceed number of field
			tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
			return tbl_start;
		}

		tbl_item.num_of_fields = num_fields;

		if (tbl_item.struct == EN_TBL_STRUCT_LIST) {
			k = 2;
			while ((TBL_MAX_RECORD_SIZE % record_size)>0 && record_size<TBL_MAX_RECORD_SIZE+1 && record_size>0) {
				if (record_size>k) {
					k = k*2;
				} else {
					record_size = k;
				}
			}
		}

		if (record_size>TBL_MAX_RECORD_SIZE) {
			#if TBL_DEBUG_PRINT
				 tbl_debugprint("ERROR (table '"+tbl_item.table_name+"'): TBL_MAX_RECORD_SIZE is too small. It is now "+str(TBL_MAX_RECORD_SIZE)+", it should be bigger than "+str(record_size)+" and in power of 2.");
			#endif
			tbl_info_index = 0;//you need to increase TBL_MAX_RECORD_SIZE!
			tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
			return tbl_start;
		}
		if (max_record_size<record_size) { max_record_size = record_size;}
		tbl_item.rec_size = record_size;

		tbl_item.clean_start = NO;

		if (tbl_info_index<TBL_MAX_NUM_TABLES) {
			tbl_info[tbl_info_index] = tbl_item;
		}
		tbl_info_index = tbl_info_index+1;
	}

	if (tbl_info_index>TBL_MAX_NUM_TABLES) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: total number of tables is "+str(tbl_info_index)+" while you have 'TBL_MAX_NUM_TABLES "+str(TBL_MAX_NUM_TABLES)+"'.");
		#endif
		tbl_info_index = 0;//you need to increase TBL_MAX_NUM_TABLES!
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}
	if (field_index>TBL_MAX_TOTAL_NUM_FIELDS) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("ERROR: total number of fields is "+str(field_index)+" while you have 'TBL_MAX_TOTAL_NUM_FIELDS "+str(TBL_MAX_TOTAL_NUM_FIELDS)+"'.");
		#endif
		field_index = 0;//you need to increase TBL_MAX_TOTAL_NUM_FIELDS!
		tbl_start = EN_TBL_STATUS_WRONG_DEFINE;
		return tbl_start;
	}

	tbl_init_flag = TBL_INIT_SIGNATURE;
	#if TBL_DEBUG_PRINT
		tbl_debugprint("Number of tables: "+str(tbl_info_index));
		tbl_debugprint("Number of fields: "+str(field_index));

		if (tbl_info_index<TBL_MAX_NUM_TABLES) {
			tbl_debugprint("YOU ARE WASTING MEMORY!!! Set TBL_MAX_NUM_TABLES to "+str(tbl_info_index)+". It is now "+str(TBL_MAX_NUM_TABLES)+".");
		}

		if (max_tbl_name_len<TBL_MAX_TABLE_NAME_LEN) {
			tbl_debugprint("YOU ARE WASTING MEMORY!!! Set TBL_MAX_TABLE_NAME_LEN to "+str(max_tbl_name_len)+". It is now "+str(TBL_MAX_TABLE_NAME_LEN)+".");
		}

		if (field_index<TBL_MAX_TOTAL_NUM_FIELDS) {
			tbl_debugprint("YOU ARE WASTING MEMORY!!! Set TBL_MAX_TOTAL_NUM_FIELDS to "+str(field_index)+". It is now "+str(TBL_MAX_TOTAL_NUM_FIELDS)+".");
		}

		if (max_fld_name_len<TBL_MAX_FIELD_NAME_LEN) {
			tbl_debugprint("YOU ARE WASTING MEMORY!!! Set TBL_MAX_FIELD_NAME_LEN to "+str(max_fld_name_len)+". It is now "+str(TBL_MAX_FIELD_NAME_LEN)+".");
		}

		k = 2;
		while ((TBL_MAX_RECORD_SIZE % max_record_size)>0 && max_record_size<TBL_MAX_RECORD_SIZE+1 && record_size>0) {
			if (max_record_size>k) {
				k = k*2;
			} else {
				max_record_size = k;
			}
		}
		if (max_record_size<TBL_MAX_RECORD_SIZE) {
			tbl_debugprint("YOU ARE WASTING MEMORY!!! Set TBL_MAX_RECORD_SIZE to "+str(max_record_size)+". It is now "+str(TBL_MAX_RECORD_SIZE)+".");
		}
	#endif

	tbl_info_index = 0;

	#if TBL_DEBUG_PRINT
		tbl_debug_print_error("tbl_start()",tbl_start);
	#endif

return tbl_start;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_select(string *table_name_or_num, string *file_name) {
en_tbl_status_codes tbl_select;
//API procedure, selecting the data file that is used in following table operations, if such data file does not exist, a new file will be created, 
//based on the table info provided(table_name_or_num)
//if file is created then attributes set to NULL
//fills tbl_record_string with default values

	pl_fd_status_codes fd_status;
	unsigned char f;
	unsigned int i, j;
	string s;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_select = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_select("+*table_name_or_num+")",tbl_select);
		#endif		
		return tbl_select;
	}

	if (len(*table_name_or_num)>TBL_MAX_TABLE_NAME_LEN || len(*file_name)>TBL_MAX_FILE_NAME_LEN) {
		tbl_select = EN_TBL_STATUS_INV_PARAM;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_select("+*table_name_or_num+")",tbl_select);
		#endif
		return tbl_select;
	}

	if (fd.ready == NO) { goto tbl_fail;}
	//find table

	#if TBL_DEBUG_PRINT
		tbl_do_not_debug_print = YES;
	#endif
	if (tbl_info_find(*table_name_or_num,f) != EN_TBL_STATUS_OK) {
		#if TBL_DEBUG_PRINT
			tbl_do_not_debug_print = NO;
		#endif
		goto tbl_unknown_tbl;
	}

	#if TBL_DEBUG_PRINT
		tbl_do_not_debug_print = NO;
	#endif

	//open file (or switch filenum)
file_open: 
	i = filenum_open("TBL",*file_name,fd_status);
	switch (fd_status) {
	case PL_FD_STATUS_NOT_FOUND:

		//need to create this file

		if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
		fd_status = fd.create(*file_name);
		if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}
		if (fd_status != PL_FD_STATUS_OK) {
			goto tbl_fail;
		}

		//reset all attribute
		if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
		tbl_attributes_sg(*file_name,"","",EN_TBL_SET);
		if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}

		i = filenum_open("TBL",*file_name,fd_status);
		if (fd_status != PL_FD_STATUS_OK) {
			goto fail_to_open;
		}
		break;

	case PL_FD_STATUS_OK:
case PL_FD_STATUS_ALREADY_OPENED:

		if (i == 255) { goto fail_to_open;}
		break;

	default:
		//some other problem
fail_to_open: 
		if (callback_tbl_fail_to_open(*file_name,fd_status,i) == YES) {
			goto file_open;
		} else {
			goto tbl_fail;
		}break;
	}

	fd.filenum = i;

	//skip the rest if it is currently selected table.
	if (f == tbl_info_index && *file_name == tbl_selected_file_name) {
		goto tbl_ok;
	}

	tbl_info_index = f;
	tbl_selected_file_name = *file_name;
	tbl_get_num_records(tbl_selected_all_rc,yes);

	if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
	if (tbl_active_rc_sg(tbl_selected_active_rc,EN_TBL_GET) != PL_FD_STATUS_OK) { goto fd_error;}
	if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}

	//fill up tbl_record_string with default value
	for (j=0; j <= tbl_info(tbl_info_index).num_of_fields-1; j++) {
		i = tbl_info[tbl_info_index].field_num_offset+j;
		if (tbl_field_info[i].field_name == "MD5" || tbl_field_info[i].field_name == "UID") {
			s = strgen(4,chr(0));
		} else {
			tbl_get_field_def(str(tbl_info_index),tbl_field_info[i].field_name,s);
		}
		tbl_field_sg(tbl_field_info[i].field_name,s,EN_TBL_SET);
	}
	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_FOUND:
goto tbl_unknown_file;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_file;
	break;
	default:goto tbl_fail;break;
	}

tbl_ok: 
	tbl_select = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	tbl_select = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_unknown_file: 
	tbl_select = EN_TBL_STATUS_UNKNOWN_FILE;
	goto finish;
tbl_unknown_tbl: 
	tbl_select = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_select = EN_TBL_STATUS_FAILURE;}
	if (tbl_select != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_select);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_select("+*table_name_or_num+")",tbl_select);
		#endif
	}
	return tbl_select;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_select_for_read(string *table_name_or_num, string *file_name) {
en_tbl_status_codes tbl_select_for_read;
//API procedure, selecting the data file that is used in following table operations, if such data file does not exist, a new file will be created, 
//based on the table info provided(table_name_or_num)
//if file is created then attributes set to NULL
//fills tbl_record_string with default values

	pl_fd_status_codes fd_status;
	unsigned char f;
	unsigned int i, j;
	string s;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_select_for_read = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_select_for_read("+*table_name_or_num+")",tbl_select_for_read);
		#endif		
		return tbl_select_for_read;
	}

	if (len(*table_name_or_num)>TBL_MAX_TABLE_NAME_LEN || len(*file_name)>TBL_MAX_FILE_NAME_LEN) {
		tbl_select_for_read = EN_TBL_STATUS_INV_PARAM;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_select_for_read("+*table_name_or_num+")",tbl_select_for_read);
		#endif
		return tbl_select_for_read;
	}

	if (fd.ready == NO) { goto tbl_fail;}
	//find table

	#if TBL_DEBUG_PRINT
		tbl_do_not_debug_print = YES;
	#endif
	if (tbl_info_find(*table_name_or_num,f) != EN_TBL_STATUS_OK) {
		#if TBL_DEBUG_PRINT
			tbl_do_not_debug_print = NO;
		#endif
		goto tbl_unknown_tbl;
	}

	#if TBL_DEBUG_PRINT
		tbl_do_not_debug_print = NO;
	#endif

	//open file (or switch filenum)
file_open: 
	i = filenum_open("TBL",*file_name,fd_status);
	switch (fd_status) {
	case PL_FD_STATUS_NOT_FOUND:

		//need to create this file

		if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
		fd_status = fd.create(*file_name);
		if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}
		if (fd_status != PL_FD_STATUS_OK) {
			goto tbl_fail;
		}

		//reset all attribute
		if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
		tbl_attributes_sg(*file_name,"","",EN_TBL_SET);
		if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}

		i = filenum_open("TBL",*file_name,fd_status);
		if (fd_status != PL_FD_STATUS_OK) {
			goto fail_to_open;
		}
		break;

	case PL_FD_STATUS_OK:
case PL_FD_STATUS_ALREADY_OPENED:

		if (i == 255) { goto fail_to_open;}
		break;

	default:
		//some other problem
fail_to_open: 
		if (callback_tbl_fail_to_open(*file_name,fd_status,i) == YES) {
			goto file_open;
		} else {
			goto tbl_fail;
		}break;
	}

	fd.filenum = i;

	//skip the rest if it is currently selected table.
	if (f == tbl_info_index && *file_name == tbl_selected_file_name) {
		goto tbl_ok;
	}

	tbl_info_index = f;
	tbl_selected_file_name = *file_name;
	tbl_get_num_records(tbl_selected_all_rc,yes);

	if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
	if (tbl_active_rc_sg(tbl_selected_active_rc,EN_TBL_GET) != PL_FD_STATUS_OK) { goto fd_error;}
	if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}

	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_FOUND:
goto tbl_unknown_file;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_file;
	break;
	default:goto tbl_fail;break;
	}

tbl_ok: 
	tbl_select_for_read = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	tbl_select_for_read = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_unknown_file: 
	tbl_select_for_read = EN_TBL_STATUS_UNKNOWN_FILE;
	goto finish;
tbl_unknown_tbl: 
	tbl_select_for_read = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_select_for_read = EN_TBL_STATUS_FAILURE;}
	if (tbl_select_for_read != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_select_for_read);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_select_for_read("+*table_name_or_num+")",tbl_select_for_read);
		#endif
	}
	return tbl_select_for_read;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_close(string *file_name) {
en_tbl_status_codes tbl_close;

//<<<<<<<<<<<<<<<<<<<<<<<<<<< UNFINISHED
unsigned char f;


tbl_ok: 
	tbl_close = EN_TBL_STATUS_OK;
	goto finish;
tbl_unknown_file: 
	tbl_close = EN_TBL_STATUS_UNKNOWN_FILE;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_close = EN_TBL_STATUS_FAILURE;}
	f = filenum_open("TBL",*file_name,tbl_close);
	filenum_release(f);
	if (tbl_close != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_close);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_close("+*file_name+")",tbl_close);
		#endif
	}
	return tbl_close;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_clear() {
en_tbl_status_codes tbl_clear;
//tbl_select() must be used
//API procedure, a selected data file is required, sets the selected data file size to 0, all file attribute will be set to NULL

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_clear = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_clear()",tbl_clear);
		#endif		
		return tbl_clear;
	}

	if (tbl_selected_file_name == "") {
		tbl_clear = EN_TBL_STATUS_UNKNOWN_FILE;
		goto finish;
	}

	if (fd.setfilesize(0) != PL_FD_STATUS_OK) {
		tbl_clear = EN_TBL_STATUS_FAILURE;
		goto finish;
	}

	if (fd.transactionstart() != PL_FD_STATUS_OK) { goto tbl_fail;}
	if (tbl_attributes_sg(tbl_selected_file_name,"","",EN_TBL_SET) != PL_FD_STATUS_OK) { goto tbl_fail;}
	tbl_clear = tbl_get_num_records(tbl_selected_all_rc,yes);
	if (tbl_clear != EN_TBL_STATUS_OK) { goto finish;}
	if (tbl_active_rc_sg(tbl_selected_active_rc,EN_TBL_GET) != PL_FD_STATUS_OK) { goto tbl_fail;}
	if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto tbl_fail;}
	callback_tbl_modified(tbl_selected_file_name,EN_TBL_MODIFIED_CLEAR);
	goto tbl_ok;

tbl_ok: 
	tbl_clear = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	tbl_clear = EN_TBL_STATUS_FAILURE;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_clear = EN_TBL_STATUS_FAILURE;}
	if (tbl_clear != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_clear);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_clear()",tbl_clear);
		#endif
	}
	return tbl_clear;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_replace(string *old_file_name, string *new_file_name) {
en_tbl_status_codes tbl_replace;
//API procedure, delete the old data file (old_file_name), and rename the new data file (new_file_name) to old data file name (old_file_name).

	unsigned char i;
	pl_fd_status_codes fd_status;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_replace = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_replace()",tbl_replace);
		#endif		
		return tbl_replace;
	}

	if (*old_file_name == "" || *new_file_name == "") {
		tbl_replace = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_replace()",tbl_replace);
		#endif		
		return tbl_replace;
	}

	if (len(*old_file_name)>TBL_MAX_FILE_NAME_LEN || len(*new_file_name)>TBL_MAX_FILE_NAME_LEN) {
		tbl_replace = EN_TBL_STATUS_INV_PARAM;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_replace()",tbl_replace);
		#endif
		return tbl_replace;
	}

	//if one of the file is selected, unselect the file.
	if (tbl_selected_file_name == *old_file_name || tbl_selected_file_name == *new_file_name) {
		tbl_selected_file_name = "";
	}

	//close both files
	if (fd.ready == NO) { goto tbl_fail;}
	i = filenum_open("TBL",*old_file_name,fd_status);
	if (i != 255) { filenum_release(i);}
	i = filenum_open("TBL",*new_file_name,fd_status);
	if (i != 255) { filenum_release(i);}

	if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
	if (fd.delete(*old_file_name) != PL_FD_STATUS_OK) {
		goto fd_error;
	}

	if (fd.rename(*new_file_name,*old_file_name) != PL_FD_STATUS_OK) { goto fd_error;}
	if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}
	callback_tbl_modified(*old_file_name,EN_TBL_MODIFIED_REPLACE);
	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_FOUND:
goto tbl_unknown_file;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_file;
	break;
	default:goto tbl_fail;break;
	}

tbl_ok: 
	tbl_replace = EN_TBL_STATUS_OK;
	goto finish;
tbl_unknown_file: 
	tbl_replace = EN_TBL_STATUS_UNKNOWN_FILE;
	goto finish;
tbl_fail: 
	tbl_replace = EN_TBL_STATUS_FAILURE;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_replace = EN_TBL_STATUS_FAILURE;}
	if (tbl_replace != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_replace);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_replace()",tbl_replace);
		#endif
	}
	return tbl_replace;
}

//------------------------------------------------------------------------------
#if TBL_AGGREGATE_HASH
string tbl_get_hash() {
string tbl_get_hash;
//tbl_select() must be used
//API procedure, a selected data file is required, returns the current hash value of the selected data file.

	string<4> hash;
	unsigned int msw, lsw;
	unsigned long hash_val;

	if (tbl_selected_file_name == "") {
		tbl_get_hash = "";
		return tbl_get_hash;
	}

	if (tbl_selected_active_rc == 0) {
		hash_val = 0;
	} else {
		fd.transactionstart();
		tbl_attributes_sg(tbl_selected_file_name,"HASH",hash,EN_TBL_GET);
		fd.transactioncommit();
		msw = asc(left(hash,1))*256+asc(mid(hash,2,1));
		lsw = asc(mid(hash,3,1))*256+asc(mid(hash,4,1));
		hash_val = msw*65536+lsw;
	}
	tbl_get_hash = lstri(hash_val);
	return tbl_get_hash;
}
#endif

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_sg(unsigned int *rec_num, en_tbl_rdwr op) {
en_tbl_status_codes tbl_record_sg;
//tbl_select() must be used
//depends on record ptr
//API procedure, a selected data file is required, loads the record pointed at by tbl_record_ptr to record buffer (tbl_record_string).

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_record_sg = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_sg",tbl_record_sg);
		#endif		
		return tbl_record_sg;
	}

	if (tbl_selected_file_name == "") {
		tbl_record_sg = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_sg",tbl_record_sg);
		#endif		
		return tbl_record_sg;
	}

	if (fd.ready == NO) { goto tbl_fail;}

	//set pointer
	tbl_record_ptr_sg(*rec_num,EN_TBL_SET);

	if (op == EN_TBL_GET) {
	//get data
		if (fd.pointer>fd.filesize || fd.filesize == 0) { goto tbl_not_found;}
		tbl_record_string = fd.getdata(tbl_info[tbl_info_index].rec_size);
		if (fd.laststatus != PL_FD_STATUS_OK) { goto tbl_fail;}
	} else {
	//set data
		tbl_record_string = left(tbl_record_string,tbl_info[tbl_info_index].rec_size);
		if (fd.transactionstart() != PL_FD_STATUS_OK) { goto fd_error;}
		if (fd.setdata(tbl_record_string) != PL_FD_STATUS_OK) { goto fd_error;}
		if (fd.transactioncommit() != PL_FD_STATUS_OK) { goto fd_error;}
		callback_tbl_modified(tbl_selected_file_name,EN_TBL_MODIFIED_EDIT);
	}

	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_FOUND:
goto tbl_unknown_file;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_file;
	break;
	default:goto tbl_fail;break;
	}
tbl_ok: 
	tbl_record_sg = EN_TBL_STATUS_OK;
	goto finish;
tbl_not_found: 
	tbl_record_sg = EN_TBL_STATUS_NOT_FOUND;
	goto finish;
tbl_unknown_file: 
	tbl_record_sg = EN_TBL_STATUS_UNKNOWN_FILE;
	goto finish;
tbl_fail: 
	tbl_record_sg = EN_TBL_STATUS_FAILURE;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_record_sg = EN_TBL_STATUS_FAILURE;}
	if (tbl_record_sg != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_record_sg);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_sg",tbl_record_sg);
		#endif
	}
	return tbl_record_sg;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_add(string<32> uid) {
en_tbl_status_codes tbl_record_add;
//tbl_select() must be used

//API procedure, a selected data file is required, stores the data in the record buffer (tbl_record_string) to the selectd data file.
//If the table type is "T"(table) the record will overwrite the first deleted record, if there is no deleted record, the
//record will be appended to the end of the selected data file.
//If the the table type is "L"(list) the record will always be appended to the end of the seleted data file.
//If TBL_ADJUST_LIST_WHEN_FULL is set to 1, table type is "L"(list) this operation will also try to remove data from the top of the data file,
//if and only if there is a sector, which if full with deleted record.
//The data file hash and record count are updated accordingly.

	string<TBL_MAX_RECORD_SIZE> temp;
	unsigned long daddr1, dwtemp;
	no_yes add_to_del_pos;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_record_add = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_add()",tbl_record_add);
		#endif		
		return tbl_record_add;
	}

	if (tbl_selected_file_name == "") {
		tbl_record_add = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_add()",tbl_record_add);
		#endif		
		return tbl_record_add;
	}

	if (fd.ready == NO) { goto tbl_fail;}

#if TBL_AGGREGATE_HASH
	//if hash is enabled, the new hash will be calculated and stored to the file attribute
	unsigned long md5_val;
	en_tbl_status_codes result;

	if (tbl_info[tbl_info_index].struct == EN_TBL_STRUCT_TABLE) {
		result = tbl_generate_uid(uid);
		if (result != EN_TBL_STATUS_OK) {
			tbl_record_add = result;
			goto finish;
		}
		md5_val = tbl_set_md5();
	}
#endif
	if (tbl_info[tbl_info_index].clean_start == NO) {
		if (tbl_check_key_violation(0) == YES) { goto tbl_key_violate;}
	}

	//find the first deleted record, if not found move the pointer to the end of file and set data
	if (tbl_info[tbl_info_index].struct == EN_TBL_STRUCT_LIST) {
		//check if table is full

		dwtemp = tbl_info[tbl_info_index].rec_size;
		dwtemp = dwtemp*tbl_info[tbl_info_index].maxrecs;

		#if TBL_DISCARD_OLD_RECORD_WHEN_FULL
			unsigned int rec_num, count;
			rec_num = 1;
			count = 256/tbl_info[tbl_info_index].rec_size;
			while ( ~ (fd.filesize<dwtemp) && count>0) {
				tbl_record_delete(rec_num);
				count = count-1;
			}

		#endif			

		#if TBL_ADJUST_LIST_WHEN_FULL
			if (fd.transactionstart()) { goto fd_error;}
			if (tbl_adjust_size() != EN_TBL_STATUS_OK) { goto fd_error;}
			if (fd.transactioncommit()) { goto fd_error;}
		#endif		
		if ( ~ (fd.filesize<dwtemp)) { goto tbl_full;}
		daddr1 = fd.filesize+1;
		add_to_del_pos = NO;
	} else {
		if (tbl_info[tbl_info_index].clean_start == NO) {
			daddr1 = fd.find(1,TBL_DELETE_FLAG,1,FORWARD,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
			if (daddr1 == 0) {
add_at_bottom: 
				//check if table is full
				dwtemp = tbl_info[tbl_info_index].rec_size;
				dwtemp = dwtemp*tbl_info[tbl_info_index].maxrecs;
				if ( ~ (fd.filesize<dwtemp)) { goto tbl_full;}
				daddr1 = fd.filesize+1;
				add_to_del_pos = NO;
			} else {
				add_to_del_pos = YES;
			}
		} else {
			goto add_at_bottom;
		}
	}

	fd.setpointer(daddr1);
	tbl_record_string = mid(tbl_record_string,2,tbl_info[tbl_info_index].rec_size-1);
	tbl_record_string = TBL_ACTIVE_FLAG+tbl_record_string;
	temp = strgen(tbl_info[tbl_info_index].rec_size-len(tbl_record_string),chr(TBL_NULL));
	tbl_record_string = tbl_record_string+temp;

	if (fd.transactionstart()) { goto fd_error;}
	if (fd.setdata(tbl_record_string) != PL_FD_STATUS_OK) { goto fd_error;}
	tbl_selected_active_rc = tbl_selected_active_rc+1;
	if (add_to_del_pos == NO) { tbl_selected_all_rc = tbl_selected_all_rc+1;}
	if (tbl_active_rc_sg(tbl_selected_active_rc,EN_TBL_SET) != PL_FD_STATUS_OK) { goto fd_error;}
	if (fd.transactioncommit()) { goto fd_error;}
	callback_tbl_modified(tbl_selected_file_name,EN_TBL_MODIFIED_ADD);
	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_FOUND:
goto tbl_unknown_file;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_file;
	break;
	case PL_FD_STATUS_DATA_FULL:
goto tbl_full;
	break;
	default:goto tbl_fail;break;
	}

tbl_ok: 
	#if TBL_AGGREGATE_HASH				
		tbl_mod_hash(md5_val);
	#endif
	//set the pointer to the record position (it might be the last record, or the first deleted record position)
	tbl_record_add = EN_TBL_STATUS_OK;
	goto finish;
tbl_unknown_file: 
	tbl_record_add = EN_TBL_STATUS_UNKNOWN_FILE;
	goto finish;
tbl_fail: 
	tbl_record_add = EN_TBL_STATUS_FAILURE;//fd errors, and other errors
	goto finish;
tbl_full: 
	tbl_record_add = EN_TBL_STATUS_FULL;
	goto finish;
tbl_key_violate: 
	tbl_record_add = EN_TBL_STATUS_KEY_VIOLATION;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_record_add = EN_TBL_STATUS_FAILURE;}
	if (tbl_record_add != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_record_add);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_add()",tbl_record_add);
		#endif
	}
	return tbl_record_add;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_edit(unsigned int *rec_num) {
en_tbl_status_codes tbl_record_edit;
//tbl_select() must be used
//depends on record ptr

//API procedure, a selected data file is required, overwrites the current record (pointed by tbl_record_ptr) with the data from the record buffer(tbl_record_string).
//The data file hash is updated accordingly

	unsigned int w;
	no_yes key_violation_found;
	string<1> sflag;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_record_edit = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_edit()",tbl_record_edit);
		#endif
		return tbl_record_edit;
	}

	if (tbl_selected_file_name == "") {
		tbl_record_edit = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_edit()",tbl_record_edit);
		#endif
		return tbl_record_edit;
	}

#if TBL_AGGREGATE_HASH
	unsigned long md5_val, md5_val_old;
	string<16> md5_string;
	tbl_record_edit = tbl_field_sg("MD5",md5_string,EN_TBL_GET);
	if (tbl_record_edit != EN_TBL_STATUS_OK) { goto finish;}
	md5_val_old = lval(md5_string);
	md5_val = tbl_set_md5();
#endif

	//check for key violation
	key_violation_found = tbl_check_key_violation(w);
	if (key_violation_found == YES && w != *rec_num) {
		tbl_record_edit = EN_TBL_STATUS_KEY_VIOLATION;
		return tbl_record_edit;
	}

	//check if the record is deleted
	tbl_record_edit = tbl_record_ptr_sg(*rec_num,EN_TBL_SET);
	if (tbl_record_edit != EN_TBL_STATUS_OK) { goto finish;}
	sflag = fd.getdata(1);
	if (sflag != TBL_ACTIVE_FLAG) {
		tbl_record_edit = EN_TBL_STATUS_DELETED;
		return tbl_record_edit;
	}

	tbl_record_edit = tbl_record_sg(*rec_num,EN_TBL_SET);
	if (tbl_record_edit == EN_TBL_STATUS_OK) {
#if TBL_AGGREGATE_HASH
	tbl_mod_hash(md5_val_old);
	tbl_mod_hash(md5_val);
#endif
	}

finish: 
	if (fd.ready == NO) { tbl_record_edit = EN_TBL_STATUS_FAILURE;}
	if (tbl_record_edit != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_record_edit);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_edit()",tbl_record_edit);
		#endif
	}
	return tbl_record_edit;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_read_active(unsigned int *rec_num) {
en_tbl_status_codes tbl_record_read_active;
//tbl_select() must be used
//depends on record ptr

//API procedure, a selected data file is required, load the record buffer(tbl_record_string) with the record that pointed by record pointer(tbl_record_ptr)

	unsigned long daddr;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_record_read_active = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_read_active()",tbl_record_read_active);
		#endif
		return tbl_record_read_active;
	}

	if (tbl_selected_file_name == "") {
		tbl_record_read_active = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_read_active()",tbl_record_read_active);
		#endif
		return tbl_record_read_active;
	}

	tbl_record_read_active = tbl_record_ptr_sg(*rec_num,EN_TBL_SET);

	if (fd.pointer>=fd.filesize) {
		goto not_found;
	}

	daddr = fd.find(fd.pointer,TBL_ACTIVE_FLAG,1,FORWARD,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);

	if (daddr == 0) {
not_found: 
		*rec_num = 0;
		tbl_record_read_active = EN_TBL_STATUS_END_OF_TABLE;
		return tbl_record_read_active;
	}

	*rec_num = (daddr/tbl_info[tbl_info_index].rec_size)+1;

	tbl_record_read_active = tbl_record_sg(*rec_num,EN_TBL_GET);
finish: 
	if (tbl_record_read_active == EN_TBL_STATUS_OK) { return tbl_record_read_active;}
	#if TBL_DEBUG_PRINT
		tbl_debug_print_error("tbl_record_read_active()",tbl_record_read_active);
	#endif
	return tbl_record_read_active;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_delete(unsigned int *rec_num) {
en_tbl_status_codes tbl_record_delete;
//tbl_select() must be used
//depends on record ptr

//API procedure, a selected data file is required, deletes a record.
//If the table type is "T"(table) the record that is pointed by the record pointer will be mark as deleted.
//If the table type is "L"(list) the first active record in the top of the selected data file will be mark as deleted.
//If TBL_ADJUST_LIST_WHEN_FULL is set to 0, and table type is "L"(list) this operation will also try to remove data from the top of the data file,
//if and only if there is a sector, which if full with deleted record.
//The data file hash and record count are updated accordingly.

	unsigned long dptr;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_record_delete = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_delete()",tbl_record_delete);
		#endif
		return tbl_record_delete;
	}

	if (tbl_selected_file_name == "") {
		tbl_record_delete = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_delete()",tbl_record_delete);
		#endif
		return tbl_record_delete;
	}

	if (fd.ready == NO) { goto tbl_fail;}

	//examine if the record is deleted
	if (tbl_info[tbl_info_index].struct == EN_TBL_STRUCT_LIST) {
		dptr = fd.find(1,TBL_ACTIVE_FLAG,1,FORWARD,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
		if (dptr == 0) { goto tbl_deleted;}
		fd.setpointer(dptr);
	} else {
		if (tbl_is_record_deleted(*rec_num) == YES) { goto tbl_deleted;}
		tbl_record_delete = tbl_record_ptr_sg(*rec_num,EN_TBL_SET);
		if (tbl_record_delete != EN_TBL_STATUS_OK) { return tbl_record_delete;}
	}

	//delete record
	if (tbl_selected_active_rc>0) {
		if (fd.transactionstart()) { goto fd_error;}
		tbl_selected_active_rc = tbl_selected_active_rc-1;
		if (tbl_active_rc_sg(tbl_selected_active_rc,EN_TBL_SET) != PL_FD_STATUS_OK) { goto fd_error;}
		if (fd.setdata(TBL_DELETE_FLAG) != PL_FD_STATUS_OK) { goto fd_error;}
		#if TBL_ADJUST_LIST_WHEN_FULL == 0
			if (tbl_adjust_size() != EN_TBL_STATUS_OK) { goto fd_error;}
		#endif
		if (fd.transactioncommit()) { goto fd_error;}
		callback_tbl_modified(tbl_selected_file_name,EN_TBL_MODIFIED_DELETE);
	} else {
		goto tbl_deleted;
	}
	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_file;
	break;
	case PL_FD_STATUS_NOT_FOUND:
goto tbl_deleted;
	break;
	default:goto tbl_fail;break;
	}

tbl_ok: 
#if TBL_AGGREGATE_HASH
	unsigned long md5_val;
	tbl_record_sg(*rec_num,EN_TBL_GET);
	md5_val = tbl_set_md5();
	tbl_mod_hash(md5_val);
#endif
	tbl_record_delete = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	tbl_record_delete = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_unknown_file: 
	tbl_record_delete = EN_TBL_STATUS_UNKNOWN_FILE;
	goto finish;
tbl_deleted: 
	tbl_record_delete = EN_TBL_STATUS_DELETED;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_record_delete = EN_TBL_STATUS_FAILURE;}
	if (tbl_record_delete != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_record_delete);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_delete()",tbl_record_delete);
		#endif
	}
	return tbl_record_delete;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_undelete(unsigned int *rec_num) {
en_tbl_status_codes tbl_record_undelete;
//tbl_select() must be used
//depends on record ptr

//API procedure, a selected data file is required, undelete a deleted record.
//If the table type is "T"(table) the record that is pointed by the record pointer will be mark as active.
//If the table type is "L"(list) the last deleted record in the top of the selected data file will be mark as active.

	unsigned long d, dptr;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_record_undelete = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_undelete()",tbl_record_undelete);
		#endif
		return tbl_record_undelete;
	}

	if (tbl_selected_file_name == "") {
		tbl_record_undelete = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_undelete()",tbl_record_undelete);
		#endif
		return tbl_record_undelete;
	}

	if (fd.ready == NO) { goto tbl_fail;}

	//examine if the record is deleted
	if (tbl_info[tbl_info_index].struct == EN_TBL_STRUCT_LIST) {
		d = fd.filesize-tbl_info[tbl_info_index].rec_size+1;
		dptr = fd.find(d,TBL_DELETE_FLAG,1,BACK,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
		if (dptr == 0) { goto tbl_ok;}
		fd.setpointer(dptr);
	} else {
		if (tbl_is_record_deleted(*rec_num) == NO) { goto tbl_ok;}
		tbl_record_undelete = tbl_record_ptr_sg(*rec_num,EN_TBL_SET);
		if (tbl_record_undelete != EN_TBL_STATUS_OK) { return tbl_record_undelete;}
	}

	//undelete record	
	if (fd.transactionstart()) { goto fd_error;}
	if (fd.setdata(TBL_ACTIVE_FLAG) != PL_FD_STATUS_OK) { goto fd_error;}
	tbl_selected_active_rc = tbl_selected_active_rc+1;
	if (tbl_active_rc_sg(tbl_selected_active_rc,EN_TBL_SET) != PL_FD_STATUS_OK) { goto fd_error;}
	if (fd.transactioncommit()) { goto fd_error;}
	callback_tbl_modified(tbl_selected_file_name,EN_TBL_MODIFIED_UNDELETE);
	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_tbl;
	break;
	default:goto tbl_fail;break;
	}

tbl_ok: 
#if TBL_AGGREGATE_HASH == 1
	tbl_set_md5();
#endif
	tbl_record_undelete = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	tbl_record_undelete = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_unknown_tbl: 
	tbl_record_undelete = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
tbl_not_found: 
	tbl_record_undelete = EN_TBL_STATUS_NOT_FOUND;
	goto finish;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_record_undelete = EN_TBL_STATUS_FAILURE;}
	if (tbl_record_undelete != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_record_undelete);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_undelete()",tbl_record_undelete);
		#endif
	}
	return tbl_record_undelete;
}

//------------------------------------------------------------------------------
no_yes tbl_is_record_deleted(unsigned int rec_num) {
no_yes tbl_is_record_deleted;
//API procedure, a selected data file is required, return the status of the record that is currently pointed by the record pointer.

	string<1> s;

	tbl_is_record_deleted = YES;

	if (tbl_selected_file_name == "") { return tbl_is_record_deleted;}

	if (tbl_record_ptr_sg(rec_num,EN_TBL_SET) != EN_TBL_STATUS_OK) { return tbl_is_record_deleted;}
	s = fd.getdata(1);

	if (s == TBL_ACTIVE_FLAG) { tbl_is_record_deleted = NO;}
	return tbl_is_record_deleted;
}

//------------------------------------------------------------------------------
no_yes tbl_is_current_record_deleted() {
no_yes tbl_is_current_record_deleted;
//API procedure, check if the current record loaded in the tbl_record_string is an active record.

	if (left(tbl_record_string,1) == TBL_ACTIVE_FLAG) {
		tbl_is_current_record_deleted = NO;
	} else {
		tbl_is_current_record_deleted = YES;
	}
	return tbl_is_current_record_deleted;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_find(en_tbl_record_states record_type, string *search_data, string *field_name, unsigned int *rec_num, en_tbl_search_direction direction, pl_fd_find_modes find_method) {
en_tbl_status_codes tbl_record_find;
		//If the search includes the records that are marked as deleted.
		//Searching criteria data.
		//Searching criteria name.
		//Starting record number, also returns the first found record number
		//Searching direction
		//find method (equal, greater, lesser, etc.)

//tbl_select() must be used

//API procedure, a selected data file is required, searches through the data file, looks for "search_data" pattern
//Search starts at current (rec_num) record, goes until the end or the top of data file depending on the search direction.
//Serach direction depends on "direction"
//Search stops at the first matching record found, tbl_record_ptr is set to this record's number

	unsigned char i;
	unsigned long daddr, daddr_temp, daddr_offset;
	unsigned int field_index;
	string s;
	unsigned int w1, w2;
	string<3> temp1;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_record_find = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_find()",tbl_record_find);
		#endif
		return tbl_record_find;
	}

	if (tbl_selected_file_name == "") {
		tbl_record_find = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_find()",tbl_record_find);
		#endif
		return tbl_record_find;
	}

	if (fd.ready == NO) { goto tbl_fail;}

	if (*rec_num == 0 || *rec_num>tbl_selected_all_rc) { goto tbl_not_found;}
	daddr = (*rec_num-1);
	daddr = daddr*tbl_info[tbl_info_index].rec_size+1;

	if (*search_data != "") {
		if (tbl_field_find(*field_name,field_index) == EN_TBL_STATUS_UNKNOWN_FIELD) { goto tbl_unknown_fld;}
		switch (tbl_field_info[field_index].field_type) {
		#if TBL_TIME_TYPE_INCLUDED		
			case `T`:

				switch (tbl_field_info[field_index].p1) {
				case EN_TBL_DT_DATE:

					s = *search_data+"000000";
					td_str_to_binstr(s);
					s = left(s,2);
					break;
				case EN_TBL_DT_TIME1:

					s = "20000101"+*search_data+"00";
					td_str_to_binstr(s);
					s = mid(s,3,2);
					break;
				case EN_TBL_DT_TIME2:

					s = "20000101"+*search_data;
					td_str_to_binstr(s);
					s = mid(s,3,3);
					break;
				case EN_TBL_DT_TIME3:

					s = "20000101"+left(*search_data,6);
					temp1 = mid(*search_data,7,3);
					td_str_to_binstr(s);
					w1 = val(temp1)/256;
					w2 = val(temp1) % 256;
					s = mid(s,3,3)+chr(w1)+chr(w2);
					break;
				case EN_TBL_DT_DATE_TIME1:

					s = *search_data+"00";
					td_str_to_binstr(s);
					s = left(s,4);
					break;
				case EN_TBL_DT_DATE_TIME2:

					s = *search_data;
					td_str_to_binstr(s);
					break;
				case EN_TBL_DT_ALL:

					s = left(*search_data,14);
					temp1 = mid(*search_data,15,3);
					td_str_to_binstr(s);
					w1 = val(temp1)/256;
					w2 = val(temp1) % 256;
					s = s+chr(w1)+chr(w2);
					break;
				}
				break;
		#endif				
		case `B`:

			s = chr(val(*search_data));
			break;
		case `W`,`M`:

			w1 = val(*search_data)/256;
			w2 = val(*search_data) % 256;
			s = chr(w1)+chr(w2);
			break;
		case `S`:

			s = chr(len(*search_data))+*search_data;
			break;
		case `U`:

			w1 = lval(*search_data)/65536;
			w2 = lval(*search_data) % 65536;
			s = chr(w1/256)+chr(w1 % 256)+chr(w2/256)+chr(w2 % 256);
			break;
		case `E`:

			w1 = lval(*search_data)/65536;
			w2 = lval(*search_data) % 65536;
			s = chr(w1/256)+chr(w1 % 256)+chr(w2/256)+chr(w2 % 256);
			break;
		case `F`:

		break;
			// dim tmp_f as float=0
			// strtobin(tmp_f,search_data,4)
			// s=ftofixed(tmp_f,3)
			// s=chr(val(search_data))
		}

		for (i=tbl_info(tbl_info_index).field_num_offset; i <= field_index; i++) {
			if (i == tbl_info[tbl_info_index].field_num_offset) {
				daddr_offset = 1;
			} else {
				daddr_offset = daddr_offset+tbl_get_field_size(i-1);
			}
		}
query: 
		//extended partial equal string search
		if (find_method == PL_FD_FIND_PARTIAL_EQUAL) {
			if (tbl_field_info[field_index].field_type != `S`) {
				goto tbl_not_found;
			}
			s = right(s,len(s)-1);
			daddr_offset = daddr_offset+1;
			find_method = PL_FD_FIND_EQUAL;
		}

		if (tbl_field_info[field_index].field_type == `F`) {
			float query_num = strtof(*search_data);
			en_tbl_status_codes tbl_result = EN_TBL_STATUS_OK;
			unsigned int tmp_rec_num = -1;
			unsigned int tbl_rows = 0;
			tbl_get_num_records(tbl_rows,NO);
			if (tbl_rows == 0) { goto finish;}
			while (*rec_num<=tbl_rows) {
				tmp_rec_num = *rec_num;
				tbl_result = tbl_record_sg(tmp_rec_num,EN_TBL_GET);
				s = tbl_field_get(*field_name);
				float fnum = strtof(s);
				switch (find_method) {
				case PL_FD_FIND_EQUAL:

					if (query_num == fnum) {
						goto finish;
					}
					break;
				case PL_FD_FIND_NOT_EQUAL:

					if (query_num != fnum) {
						goto finish;
					}
					break;
				case PL_FD_FIND_GREATER:

					if (fnum>query_num) {
						goto finish;
					}
					break;
				case PL_FD_FIND_GREATER_EQUAL:

					if (fnum>=query_num) {
						goto finish;
					}
					break;
				case PL_FD_FIND_LESSER:

					if (fnum<query_num) {
						goto finish;
					}
					break;
				case PL_FD_FIND_LESSER_EQUAL:

					if (fnum<=query_num) {
						goto finish;
					}
					break;
				}
				*rec_num = *rec_num+1;
			}

		}

		daddr = daddr+daddr_offset;
		daddr_temp = fd.find(daddr,s,1,direction,tbl_info[tbl_info_index].rec_size,find_method);
		if (daddr_temp == 0) {
			goto tbl_not_found;
		} else {
			daddr = daddr_temp-daddr_offset;
		}
	}

	switch (record_type) {
	case EN_TBL_RECORD_ACTIVE:

		daddr_temp = fd.find(daddr,TBL_ACTIVE_FLAG,1,direction,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
		goto check_record;
		break;
	case EN_TBL_RECORD_DELETED:

		daddr_temp = fd.find(daddr,TBL_DELETE_FLAG,1,direction,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
check_record: 
		if (daddr_temp == 0) {
			goto tbl_not_found;
		}
		if (daddr_temp != daddr) {
			daddr = daddr_temp;
			if (*search_data != "") { goto query;}
		}
		break;
	default:break;
	}

	//set the pointer to the record.
	*rec_num = daddr/tbl_info[tbl_info_index].rec_size+1;

tbl_ok: 
	tbl_record_find = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	*rec_num = 0;
	tbl_record_find = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_unknown_tbl: 
	*rec_num = 0;
	tbl_record_find = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
tbl_unknown_fld: 
	*rec_num = 0;
	tbl_record_find = EN_TBL_STATUS_UNKNOWN_FIELD;
	goto finish;
tbl_not_found: 
	*rec_num = 0;
	tbl_record_find = EN_TBL_STATUS_NOT_FOUND;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_record_find = EN_TBL_STATUS_FAILURE;}
	if (tbl_record_find != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_record_find);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_find()",tbl_record_find);
		#endif
	}
	return tbl_record_find;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_multi_field_record_find(en_tbl_record_states record_type, string *search_data, string *starting_field, unsigned int *rec_num, en_tbl_search_direction direction, pl_fd_find_modes find_method) {
en_tbl_status_codes tbl_multi_field_record_find;
		//If the search includes the records that are marked as deleted.
		//Searching criteria data.
		//Searching criteria name.
		//Starting record number, also returns the first found record number
		//Searching direction
		//find method (equal, greater, lesser, etc.)

//tbl_select() must be used
//search_data has to be converted to raw data form before calling this function.
//API procedure, a selected data file is required, searches through the data file, looks for "search_data" pattern
//Search starts at current (rec_num) record, goes until the end or the top of data file depending on the search direction.
//Serach direction depends on "direction"
//Search stops at the first matching record found, tbl_record_ptr is set to this record's number

	unsigned char i;
	unsigned long daddr, daddr_temp, daddr_offset;
	unsigned int field_index;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_multi_field_record_find = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_multi_field_record_find()",tbl_multi_field_record_find);
		#endif
		return tbl_multi_field_record_find;
	}

	if (tbl_selected_file_name == "") {
		tbl_multi_field_record_find = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_multi_field_record_find()",tbl_multi_field_record_find);
		#endif
		return tbl_multi_field_record_find;
	}

	if (fd.ready == NO) { goto tbl_fail;}

	if (*rec_num == 0 || *rec_num>tbl_selected_all_rc) { goto tbl_not_found;}
	daddr = (*rec_num-1);
	daddr = daddr*tbl_info[tbl_info_index].rec_size+1;

	if (*search_data != "") {
		if (tbl_field_find(*starting_field,field_index) == EN_TBL_STATUS_UNKNOWN_FIELD) { goto tbl_unknown_fld;}

		for (i=tbl_info(tbl_info_index).field_num_offset; i <= field_index; i++) {
			if (i == tbl_info[tbl_info_index].field_num_offset) {
				daddr_offset = 1;
			} else {
				daddr_offset = daddr_offset+tbl_get_field_size(i-1);
			}
		}
query: 
		daddr = daddr+daddr_offset;
		daddr_temp = fd.find(daddr,*search_data,1,direction,tbl_info[tbl_info_index].rec_size,find_method);
		if (daddr_temp == 0) {
			goto tbl_not_found;
		} else {
			daddr = daddr_temp-daddr_offset;
		}
	}

	switch (record_type) {
	case EN_TBL_RECORD_ACTIVE:

		daddr_temp = fd.find(daddr,TBL_ACTIVE_FLAG,1,direction,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
		goto check_record;
		break;
	case EN_TBL_RECORD_DELETED:

		daddr_temp = fd.find(daddr,TBL_DELETE_FLAG,1,direction,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
check_record: 
		if (daddr_temp == 0) {
			goto tbl_not_found;
		}
		if (daddr_temp != daddr) {
			daddr = daddr_temp;
			if (*search_data != "") { goto query;}
		}
		break;
	default:break;
	}

	//set the pointer to the record.
	*rec_num = daddr/tbl_info[tbl_info_index].rec_size+1;

tbl_ok: 
	tbl_multi_field_record_find = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	*rec_num = 0;
	tbl_multi_field_record_find = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_unknown_tbl: 
	*rec_num = 0;
	tbl_multi_field_record_find = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
tbl_unknown_fld: 
	*rec_num = 0;
	tbl_multi_field_record_find = EN_TBL_STATUS_UNKNOWN_FIELD;
	goto finish;
tbl_not_found: 
	*rec_num = 0;
	tbl_multi_field_record_find = EN_TBL_STATUS_NOT_FOUND;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_multi_field_record_find = EN_TBL_STATUS_FAILURE;}
	if (tbl_multi_field_record_find != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_multi_field_record_find);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_multi_field_record_find()",tbl_multi_field_record_find);
		#endif
	}
	return tbl_multi_field_record_find;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_field_sg(string *field_name, string *field_value, en_tbl_rdwr op) {
en_tbl_status_codes tbl_field_sg;
//API procedure, a selected table is required, extract the field from recorder buffer(tbl_record_string) or puts the field into the recorder buffer.

	unsigned char fld_pos, fld_sz, b1, lsb, msb;
	string<TBL_MAX_RECORD_SIZE> temp1, temp2;
	string s;
	unsigned int w1, w2, w3;
	unsigned long d;
	long p1, p2;
	unsigned int i, field_index;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_field_sg = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_field_sg("+*field_name+","+*field_value+","+str(op)+")",tbl_field_sg);
		#endif
		return tbl_field_sg;
	}

	//find field
	if (tbl_field_find(*field_name,field_index) != EN_TBL_STATUS_OK) { goto tbl_unknown_fld;}
	fld_pos = 2;
	for (i=tbl_info(tbl_info_index).field_num_offset+1; i <= field_index; i++) {
		fld_pos = fld_pos+tbl_get_field_size(i-1);
	}
	p1 = tbl_field_info[field_index].p1;
	p2 = tbl_field_info[field_index].p2;
	fld_sz = tbl_get_field_size(field_index);
	if (op == EN_TBL_GET) {
		s = mid(tbl_record_string,fld_pos,fld_sz);
		switch (tbl_field_info[field_index].field_type) {
		#if TBL_TIME_TYPE_INCLUDED		
			case `T`:
//time type
				switch (tbl_field_info[field_index].p1) {
				case EN_TBL_DT_TIME1:

					s = chr(0)+chr(0)+s;//2 bytes mincount
					if (td_binstr_to_str(s) != OK) { goto tbl_invalid;}
					*field_value = mid(s,9,4);
					break;
				case EN_TBL_DT_TIME2:
//2 bytes mincount + 1 byte second
					s = chr(0)+chr(0)+s;
					if (td_binstr_to_str(s) != OK) { goto tbl_invalid;}
					*field_value = mid(s,9,6);
					break;
				case EN_TBL_DT_TIME3:
//2 byte mincount + 1 byte second + 2 byte milisecond
					s = chr(0)+chr(0)+s;
					if (td_binstr_to_str(s) != OK) { goto tbl_invalid;}
					*field_value = mid(s,9,9);
					break;
				case EN_TBL_DT_DATE:
case EN_TBL_DT_DATE_TIME1:
case EN_TBL_DT_DATE_TIME2:
case EN_TBL_DT_ALL:

					if (td_binstr_to_str(s) != OK) { goto tbl_invalid;}
					*field_value = s;
					break;
				}
				break;
			#endif
		case `B`:
//byte type
			*field_value = str(asc(s));
			if (val(*field_value)<p1) { goto tbl_invalid;}
			if (val(*field_value)>p2) { goto tbl_invalid;}
			break;
		case `W`,`M`:
//word type
			w1 = asc(left(s,1))*256+asc(mid(s,2,1));
			*field_value = str(w1);
			if (val(*field_value)<p1) { goto tbl_invalid;}
			if (val(*field_value)>p2) { goto tbl_invalid;}
			break;
		case `S`:
//string type
			b1 = asc(left(s,1));
			*field_value = mid(s,2,b1);
			if (b1<p1) { goto tbl_invalid;}
			if (b1>p2) { goto tbl_invalid;}
			break;
		case `U`:
//unsign 32 bits
			w2 = asc(left(s,1))*256+asc(mid(s,2,1));
			w3 = asc(mid(s,3,1))*256+asc(mid(s,4,1));
			d = w2*65536+w3;
			*field_value = lstr(d);
			if (lval(*field_value)<p1) { goto tbl_invalid;}
			if (lval(*field_value)>p2) { goto tbl_invalid;}
			break;
		case `E`:
//unix timestamp
			w2 = asc(left(s,1))*256+asc(mid(s,2,1));
			w3 = asc(mid(s,3,1))*256+asc(mid(s,4,1));
			d = w2*65536+w3;
			*field_value = lstr(d);
			if (lval(*field_value)<p1) { goto tbl_invalid;}
			if (lval(*field_value)>p2) { goto tbl_invalid;}
			break;
		case `F`:

			float tmp_f = 0;
			strtobin(tmp_f,s,4);
			*field_value = ftostr(tmp_f,FTOSTR_MODE_AUTO,255);
			if (tmp_f<p1) { goto tbl_invalid;}
			if (tmp_f>p2) { goto tbl_invalid;}
			break;
		}
		goto tbl_ok;
	} else {
		switch (tbl_field_info[field_index].field_type) {
		#if TBL_TIME_TYPE_INCLUDED		
			case `T`:

				switch (tbl_field_info[field_index].p1) {
				case EN_TBL_DT_TIME1:

					s = "20000101"+*field_value;
					if (td_str_to_binstr(s) != OK) { goto tbl_invalid;}
					s = mid(s,3,2);
					break;
				case EN_TBL_DT_TIME2:

					s = "20000101"+*field_value;
					if (td_str_to_binstr(s) != OK) { goto tbl_invalid;}
					s = mid(s,3,3);
					break;
				case EN_TBL_DT_TIME3:

					s = "20000101"+left(*field_value,6);
					s = mid(s,3,5);
					break;
				case EN_TBL_DT_DATE:
case EN_TBL_DT_DATE_TIME1:
case EN_TBL_DT_DATE_TIME2:
case EN_TBL_DT_ALL:

					s = *field_value;
					if (td_str_to_binstr(s) != OK) { goto tbl_invalid;}
					break;
				}
				break;
		#endif				
		case `B`:

			if (val(*field_value)<p1) { goto tbl_invalid;}
			if (val(*field_value)>p2) { goto tbl_invalid;}
			s = chr(val(*field_value));
			break;
		case `W`,`M`:

			if (lval(*field_value)<p1) { goto tbl_invalid;}
			if (lval(*field_value)>p2) { goto tbl_invalid;}
			msb = val(*field_value)/256;
			lsb = val(*field_value) % 256;
			s = chr(msb)+chr(lsb);
			break;
		case `S`:

			if (len(*field_value)<p1) { goto tbl_invalid;}
			if (len(*field_value)>p2) { goto tbl_invalid;}
			s = chr(len(*field_value))+*field_value+strgen(fld_sz-len(*field_value)-1,chr(TBL_NULL));
			break;
		case `U`:

			if (lval(*field_value)<p1) { goto tbl_invalid;}
			if (lval(*field_value)>p2) { goto tbl_invalid;}
			w2 = lval(*field_value)/65536;
			w3 = lval(*field_value) % 65536;
			s = chr(w2/256)+chr(w2 % 256)+chr(w3/256)+chr(w3 % 256);
			break;
		case `E`:
// unix timestamp
			if (lval(*field_value)<p1) { goto tbl_invalid;}
			if (lval(*field_value)>p2) { goto tbl_invalid;}
			w2 = lval(*field_value)/65536;
			w3 = lval(*field_value) % 65536;
			s = chr(w2/256)+chr(w2 % 256)+chr(w3/256)+chr(w3 % 256);
			break;
		case `F`:

			float tmp_f = strtof(*field_value);
			if (tmp_f<p1) { goto tbl_invalid;}
			if (tmp_f>p2) { goto tbl_invalid;}
			bintostr(s,tmp_f,4);
			break;
		}
		temp1 = left(tbl_record_string,fld_pos-1);
		temp2 = right(tbl_record_string,len(tbl_record_string)-fld_pos-fld_sz+1);
		tbl_record_string = temp1+s+temp2;
		goto tbl_ok;
	}
tbl_ok: 
	tbl_field_sg = EN_TBL_STATUS_OK;
	goto finish;
tbl_unknown_tbl: 
	tbl_field_sg = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
tbl_unknown_fld: 
	tbl_field_sg = EN_TBL_STATUS_UNKNOWN_FIELD;
	goto finish;
tbl_invalid: 
	tbl_field_sg = EN_TBL_STATUS_INVALID;
finish: 
	if (tbl_field_sg != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_field_sg);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_field_sg("+*field_name+","+*field_value+","+str(op)+")",tbl_field_sg);
		#endif
	}
	return tbl_field_sg;
}

//------------------------------------------------------------------------------
void tbl_field_set(string *field_name, string *field_value) {
//API procedure, writes (sets) the value of the specified field of currently selected file, reports errors thru callback_tbl_field_error().

	en_tbl_status_codes tbl_result;

	tbl_result = tbl_field_sg(*field_name,*field_value,EN_TBL_SET);
	if (tbl_result != EN_TBL_STATUS_OK) {
		callback_tbl_field_error(tbl_selected_file_name,*field_name,tbl_result);
	}
}

//------------------------------------------------------------------------------
string tbl_field_get(string *field_name) {
string tbl_field_get;
//API procedure, reads (gets) the value of the specified field of currently selected file, reports errors thru callback_tbl_field_error(). 

	string field_value;
	en_tbl_status_codes tbl_result;

	tbl_result = tbl_field_sg(*field_name,field_value,EN_TBL_GET);
	if (tbl_result != EN_TBL_STATUS_OK) {
		callback_tbl_field_error(tbl_selected_file_name,*field_name,tbl_result);
		tbl_field_get = "";
		return tbl_field_get;
	}
	tbl_field_get = field_value;
	return tbl_field_get;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_get_field_def(string *table_name_or_num, string *field_name, string *def_value) {
en_tbl_status_codes tbl_get_field_def;
//API procedure, a selected table is required, returns the default value of selected field.

	unsigned int i, f;
	unsigned char j;
	unsigned int pos1, pos2;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_get_field_def = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_get_field_def("+*field_name+","+*def_value+")",tbl_get_field_def);
		#endif		
		return tbl_get_field_def;
	}

	tbl_get_field_def = tbl_info_find(*table_name_or_num,j);
	if (tbl_get_field_def != EN_TBL_STATUS_OK) {
		return tbl_get_field_def;
	}

	romfile.open(TBL_DESCRIPTOR_FILE);
	for (f=0; f <= tbl_info(j).num_of_fields-1; f++) {
		i = f+tbl_info[j].field_num_offset;
		if (tbl_field_info[i].field_name == *field_name) {
			pos1 = tbl_field_info[i].romaddr_def;
			pos2 = romfile.find(pos1,TBL_CR_LF,1);
			romfile.pointer = pos1;
			*def_value = tbl_get_descriptor_field(pos2,pos1);
			if (*def_value == "^") {
				*def_value = "";
			}
			goto tbl_ok;
		}
	}
	goto tbl_unknown_fld;
tbl_ok: 
	tbl_get_field_def = EN_TBL_STATUS_OK;
	goto finish;
tbl_unknown_tbl: 
	tbl_get_field_def = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
tbl_unknown_fld: 
	tbl_get_field_def = EN_TBL_STATUS_UNKNOWN_FIELD;
finish: 
	if (tbl_get_field_def != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_get_field_def);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_get_field_def("+*field_name+","+*def_value+")",tbl_get_field_def);
		#endif
	}
	return tbl_get_field_def;
}

//------------------------------------------------------------------------------
unsigned char tbl_get_field_size(unsigned int field_index) {
unsigned char tbl_get_field_size;
//API procedure, a selected table is required, returns the size of the field (number of bytes)

	unsigned char sz;

	switch (tbl_field_info[field_index].field_type) {
	#if TBL_TIME_TYPE_INCLUDED	
		case `T`:

			switch (tbl_field_info[field_index].p1) {
			case EN_TBL_DT_DATE:
sz = 2;
			break;
			case EN_TBL_DT_TIME1:
sz = 2;
			break;
			case EN_TBL_DT_TIME2:
sz = 3;
			break;
			case EN_TBL_DT_TIME3:
sz = 5;
			break;
			case EN_TBL_DT_DATE_TIME1:
sz = 4;
			break;
			case EN_TBL_DT_DATE_TIME2:
sz = 5;
			break;
			case EN_TBL_DT_ALL:
sz = 7;
			break;
			}
			break;
	#endif
	case `B`:
sz = 1;
	break;
	case `W`,`M`:
sz = 2;
	break;
	case `S`:
sz = tbl_field_info[field_index].p2+1;
	break;
	case `U`:
sz = 4;
	break;
	case `F`:
sz = 4;
	break;
	case `E`:
sz = 4;
	break;
	default:sz = 0;break;
	}
	tbl_get_field_size = sz;
	return tbl_get_field_size;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_get_num_records(unsigned int *num_of_records, no_yes include_deleted) {
en_tbl_status_codes tbl_get_num_records;
//tbl_select() must be used

//API procedure, a selected data file is required, gets total number of active records or all records(both active and inactive).

	unsigned long fz;
	//calculate the number of records

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_get_num_records = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_get_num_records("+str(*num_of_records)+","+str(include_deleted)+")",tbl_get_num_records);
		#endif		
		*num_of_records = 0;
		return tbl_get_num_records;
	}

	if (tbl_selected_file_name == "") {
		tbl_get_num_records = EN_TBL_STATUS_UNKNOWN_FILE;
		goto finish;
	}

	if (tbl_info[tbl_info_index].rec_size == 0) {
		tbl_get_num_records = EN_TBL_STATUS_UNKNOWN_TABLE;
		goto finish;
	}

	if (include_deleted == yes) {
		fz = fd.filesize;
		*num_of_records = fz/tbl_info[tbl_info_index].rec_size;
	} else {
		*num_of_records = tbl_selected_active_rc;
	}
	tbl_get_num_records = EN_TBL_STATUS_OK;
finish: 
	if (fd.ready == NO) { tbl_get_num_records = EN_TBL_STATUS_FAILURE;}
	if (tbl_get_num_records != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_get_num_records);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_get_num_records("+str(*num_of_records)+","+str(include_deleted)+")",tbl_get_num_records);
		#endif
	}
	return tbl_get_num_records;
}


//------------------------------------------------------------------------------
en_tbl_status_codes tbl_timestamp_sg(struct_tbl_timestamp *timestamp, en_tbl_rdwr op) {
en_tbl_status_codes tbl_timestamp_sg;
//tbl_select() must be used

//API procedure, a selected data file is required, sets and gets the timestamp for the selected data file.

	string<7> ts;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_timestamp_sg = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_timestamp_sg()",tbl_timestamp_sg);
		#endif
		return tbl_timestamp_sg;
	}

	if (tbl_selected_file_name == "") {
		tbl_timestamp_sg = EN_TBL_STATUS_UNKNOWN_FILE;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_timestamp_sg()",tbl_timestamp_sg);
		#endif
		return tbl_timestamp_sg;
	}

	if (fd.ready == NO) { goto tbl_fail;}

	if (op == EN_TBL_GET) {
		if (tbl_attributes_sg(tbl_selected_file_name,"TS",ts,EN_TBL_GET) != PL_FD_STATUS_OK) { goto fd_error;}
		if (fd.laststatus != PL_FD_STATUS_OK) { goto tbl_fail;}
		*timestamp.ts_daycount = 256*asc(mid(ts,1,1))+asc(mid(ts,2,1));
		*timestamp.ts_mincount = 256*asc(mid(ts,3,1))+asc(mid(ts,4,1));
		*timestamp.ts_seconds = asc(mid(ts,5,1));
		*timestamp.ts_milsec = 256*asc(mid(ts,6,1))+asc(mid(ts,7,1));
	} else {
		ts = chr(*timestamp.ts_daycount/256);
		ts = ts+chr(*timestamp.ts_daycount & 0xFF);
		ts = ts+chr(*timestamp.ts_mincount/256);
		ts = ts+chr(*timestamp.ts_mincount & 0xFF);
		ts = ts+chr(*timestamp.ts_seconds);
		ts = ts+chr(*timestamp.ts_milsec/256);
		ts = ts+chr(*timestamp.ts_milsec & 0xFF);
		if (fd.transactionstart()) { goto fd_error;}
		if (tbl_attributes_sg(tbl_selected_file_name,"TS",ts,EN_TBL_SET) != PL_FD_STATUS_OK) { goto fd_error;}
		if (fd.transactioncommit()) { goto fd_error;}
	}
	goto tbl_ok;

fd_error: 
	switch (fd.laststatus) {
	case PL_FD_STATUS_OK:
goto tbl_ok;
	break;
	case PL_FD_STATUS_ALREADY_OPENED:
goto tbl_ok;
	break;
	case PL_FD_STATUS_DUPLICATE_NAME:
goto tbl_ok;
	break;
	case PL_FD_STATUS_NOT_FOUND:
goto tbl_unknown_tbl;
	break;
	case PL_FD_STATUS_NOT_OPENED:
goto tbl_unknown_tbl;
	break;
	default:goto tbl_fail;break;
	}

tbl_ok: 
	tbl_timestamp_sg = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	tbl_timestamp_sg = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_unknown_tbl: 
	tbl_timestamp_sg = EN_TBL_STATUS_UNKNOWN_TABLE;
finish: 
	if (fd.transactionstarted == YES) { fd.transactioncommit();}
	if (fd.ready == NO) { tbl_timestamp_sg = EN_TBL_STATUS_FAILURE;}
	if (tbl_timestamp_sg != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_timestamp_sg);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_timestamp_sg()",tbl_timestamp_sg);
		#endif
	}
	return tbl_timestamp_sg;
}

//------------------------------------------------------------------------------
unsigned char tbl_get_max_field_size(string *table_name_or_num) {
unsigned char tbl_get_max_field_size;
//API procedure, a selected table sturcture is required, returns the size of the largest field for that table.

	unsigned char tbl_index, i, temp, sz, upper_bound;

	tbl_get_max_field_size = 0;
	if (tbl_info_find(*table_name_or_num,tbl_index) != EN_TBL_STATUS_OK) { return tbl_get_max_field_size;}

	if ((tbl_index<0 && tbl_info[tbl_index].field_num_offset == 0) || tbl_index == TBL_MAX_NUM_TABLES-1) {
		upper_bound = TBL_MAX_TOTAL_NUM_FIELDS-1;
	} else {
		upper_bound = tbl_info[tbl_index+1].field_num_offset-1;
	}

	sz = 0;
	for (i=tbl_info(tbl_index).field_num_offset; i <= upper_bound; i++) {
		temp = tbl_get_field_size(i)>sz;
		if (temp>sz) { sz = temp;}
	}
	return tbl_get_max_field_size;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_get_table_info(string *table_name_or_num, tbl_type *table_metadata) {
en_tbl_status_codes tbl_get_table_info;
//API procedure, a selected table sturcture is required, returns infomation for the selected table.
	unsigned char i;

	if (tbl_init_flag != TBL_INIT_SIGNATURE) {
		tbl_get_table_info = EN_TBL_STATUS_NOT_STARTED;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_get_table_info()",tbl_get_table_info);
		#endif
		return tbl_get_table_info;
	}

	tbl_get_table_info = tbl_info_find(*table_name_or_num,i);
	if (tbl_get_table_info != EN_TBL_STATUS_OK) {
		return tbl_get_table_info;
	}

	*table_metadata = tbl_info[i];
	tbl_get_table_info = EN_TBL_STATUS_OK;
	return tbl_get_table_info;
}

//------------------------------------------------------------------------------
string tbl_get_file_name() {
string tbl_get_file_name;
//API procedure, a selected data file is required, returns the name of the selected data file.

	tbl_get_file_name = tbl_selected_file_name;
	return tbl_get_file_name;
}

//------------------------------------------------------------------------------
string tbl_get_table_name() {
string tbl_get_table_name;
//API procedure, a selected data file is required, returns the name of the selected table name.

	if (tbl_selected_file_name == "") {
		tbl_get_table_name = "";
	} else {
		tbl_get_table_name = tbl_info[tbl_info_index].table_name;
	}
	return tbl_get_table_name;
}

//------------------------------------------------------------------------------
unsigned char tbl_get_num_fields(string *table_name_or_num) {
unsigned char tbl_get_num_fields;
//API procedure, retures the number of the fields for the table specify by the table_name_or_num.
	unsigned char i;

	if (tbl_info_find(*table_name_or_num,i) != EN_TBL_STATUS_OK) {
		tbl_get_num_fields = 0;
		return tbl_get_num_fields;
	}

	tbl_get_num_fields = tbl_info[i].num_of_fields;

	#if TBL_AGGREGATE_HASH
		tbl_get_num_fields = tbl_get_num_fields-2;
	#endif
	return tbl_get_num_fields;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_get_field_info(string *table_name_or_num, unsigned char field_index, tbl_field_type *field_metadata) {
en_tbl_status_codes tbl_get_field_info;
//API procedure, retures the information of the field for the table specify by the table_name_or_num.

	unsigned char i;
	unsigned int w;

	if (len(*table_name_or_num)>TBL_MAX_TABLE_NAME_LEN) {
		tbl_get_field_info = EN_TBL_STATUS_INV_PARAM;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_get_field_info()",tbl_get_field_info);
		#endif
		return tbl_get_field_info;
	}

	tbl_get_field_info = tbl_info_find(*table_name_or_num,i);
	if (tbl_get_field_info != EN_TBL_STATUS_OK) { return tbl_get_field_info;}

	if (field_index>=tbl_info[i].num_of_fields) {
		tbl_get_field_info = EN_TBL_STATUS_INV_PARAM;
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_get_field_info()",tbl_get_field_info);
		#endif
		return tbl_get_field_info;
	}

	#if TBL_AGGREGATE_HASH
		field_index = field_index+2;
	#endif

	tbl_get_field_info = EN_TBL_STATUS_OK;
	w = field_index;
	*field_metadata = tbl_field_info[w+tbl_info[i].field_num_offset];
	return tbl_get_field_info;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_adjust_size() {
en_tbl_status_codes tbl_adjust_size;
//look through the data file for the deleted records, if all records in 1 sector are deleted, then free the sector.

	unsigned int free_sector, deleted_record, record_per_sector, removing_sector;

	if (fd.ready == NO) { goto tbl_fail;}

	if (tbl_info[tbl_info_index].struct != EN_TBL_STRUCT_LIST) { goto tbl_ok;}
	record_per_sector = 256/tbl_info[tbl_info_index].rec_size;
	deleted_record = tbl_selected_all_rc-tbl_selected_active_rc;

#if TBL_ADJUST_LIST_WHEN_FULL
	free_sector = fd.getfreespace();
	if ((free_sector<1 || tbl_selected_all_rc>tbl_info[tbl_info_index].maxrecs-1) && deleted_record>=record_per_sector) {
		removing_sector = 1;
	} else {
		removing_sector = 0;
	}
#else
	removing_sector = deleted_record/record_per_sector;
#endif
	if (removing_sector>0) {
		tbl_record_ptr_sg(1,EN_TBL_SET);
		if (fd.cutfromtop(removing_sector) != PL_FD_STATUS_OK) { goto tbl_fail;}
		tbl_get_num_records(tbl_selected_all_rc,yes);
		goto tbl_ok;
	}

tbl_ok: 
	tbl_adjust_size = EN_TBL_STATUS_OK;
	goto finish;
tbl_unknown_tbl: 
	tbl_adjust_size = EN_TBL_STATUS_UNKNOWN_TABLE;
	goto finish;
tbl_fail: 
	tbl_adjust_size = EN_TBL_STATUS_FAILURE;
	goto finish;
tbl_invalid: 
	tbl_adjust_size = EN_TBL_STATUS_INVALID;
finish: 
	if (fd.ready == NO) { tbl_adjust_size = EN_TBL_STATUS_FAILURE;}
	if (tbl_adjust_size != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_adjust_size);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_adjust_size()",tbl_adjust_size);
		#endif
	}
	return tbl_adjust_size;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_info_find(string *table_name_or_num, unsigned char *index) {
en_tbl_status_codes tbl_info_find;
//Looking for the table in the table_info array, the table name can also be the index

	unsigned char i;

	i = asc(*table_name_or_num);
	if (i>=0x30 && i<=0x39) {
		i = val(*table_name_or_num);
		goto check_index;
	} else {
		for (i=0; i <= TBL_MAX_NUM_TABLES-1; i++) {
			if (tbl_info[i].table_name == *table_name_or_num) {
				goto check_index;
			}
		}
	}
	goto tbl_not_found;
check_index: 
	if (i<TBL_MAX_NUM_TABLES) {
		*index = i;
		tbl_info_find = EN_TBL_STATUS_OK;
	} else {
tbl_not_found: 
		*index = 0;
		tbl_info_find = EN_TBL_STATUS_UNKNOWN_TABLE;
	}
finish: 
	if (tbl_info_find != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_info_find);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_info_find("+*table_name_or_num+")",tbl_info_find);
		#endif
	}
	return tbl_info_find;
}

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_record_ptr_sg(unsigned int *rec_num, en_tbl_rdwr op) {
en_tbl_status_codes tbl_record_ptr_sg;
//tbl_select() must be used

//API procedure, a selected data file is required, sets the file pointer to the record that is at the position specify by rec_num. rec_num starts from 1.

	unsigned long dptr, drec;

	if (fd.ready == NO) { goto tbl_fail;}
	if (op == EN_TBL_GET) {
		*rec_num = (fd.pointer/tbl_info[tbl_info_index].rec_size)+1;
		goto tbl_ok;
	} else {
		if (*rec_num>tbl_selected_all_rc) {
			dptr = fd.filesize+1;
			*rec_num = tbl_selected_all_rc+1;
		} else {
			if (*rec_num == 0) {
				dptr = 1;
				*rec_num = 1;
			} else {
				drec = (*rec_num-1);
				dptr = drec*tbl_info[tbl_info_index].rec_size+1;
			}
		}
		if (fd.pointer != dptr) { fd.setpointer(dptr);}
		goto tbl_ok;
	}

tbl_ok: 
	tbl_record_ptr_sg = EN_TBL_STATUS_OK;
	goto finish;
tbl_fail: 
	tbl_record_ptr_sg = EN_TBL_STATUS_FAILURE;//fd errors, and other errors
finish: 
	if (fd.ready == NO) { tbl_record_ptr_sg = EN_TBL_STATUS_FAILURE;}
	if (tbl_record_ptr_sg != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_record_ptr_sg);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_record_ptr_sg("+str(*rec_num)+","+str(op)+")",tbl_record_ptr_sg);
		#endif
	}
	return tbl_record_ptr_sg;
}

en_tbl_status_codes tbl_schema_check(string *file_name) {
en_tbl_status_codes tbl_schema_check;
	en_tbl_status_codes tbl_result;
	tbl_field_type field_data;
	tbl_type table_data;
	unsigned int line_end, field_start_pos;
	unsigned char field_num, i, pointer_file;
	string s, table_name, hash;
	string schema_string = "";
	unsigned int w;
	string tables_array[TBL_MAX_NUM_TABLES];
	unsigned char table_index = 0;

	romfile.open(*file_name);
	hash = md5(schema_string,"",MD5_FINISH,0);
	pointer_file == romfile.find(romfile.pointer,"==",1);
	while (pointer_file != 0) {
		romfile.pointer = pointer_file+2;
		line_end = romfile.find(romfile.pointer,TBL_CR_LF,1);
		if (line_end == 0) {
			line_end = romfile.size+1;
		}
		table_name = tbl_get_descriptor_field(line_end,field_start_pos);
		pointer_file == romfile.find(romfile.pointer,"==",1);

		tbl_result = tbl_select(table_name,*file_name);
		if (tbl_result != EN_TBL_STATUS_OK) { goto finish;}
		field_num = tbl_get_num_fields(table_name);
		tbl_get_table_info(table_name,table_data);
		for (i=0; i <= field_num-1; i++) {
			tbl_get_field_info(table_name,i,field_data);
			schema_string = schema_string+chr(field_data.field_type)+chr(field_data.p1)+chr(field_data.p2)+chr(table_data.maxrecs);
		}
		w = strsum(schema_string);
		schema_string = chr(w/256)+chr(w % 256)+strgen(190,chr(TBL_NULL));
		hash = md5(schema_string,hash,MD5_UPDATE,0);
		tables_array[table_index] = table_name;
		table_index = table_index+1;


	}
	hash = md5(schema_string,hash,MD5_FINISH,192);
	tbl_attributes_sg(*file_name,"SCHM",s,EN_TBL_GET);
	//if schem stamp is null, file hasn't been initialized with schem stamp
	if (s == "") {
		if (fd.transactionstart() != PL_FD_STATUS_OK) {
			tbl_result = EN_TBL_STATUS_FAILURE;
			goto finish;
		}
		tbl_attributes_sg(*file_name,"SCHM",hash,EN_TBL_SET);
		for (i=0; i <= table_index-1; i++) {
		tbl_attributes_sg(tables_array[i],"SCHM",hash,EN_TBL_SET);
		}
		if (fd.transactioncommit() != PL_FD_STATUS_OK) {
			tbl_result = EN_TBL_STATUS_FAILURE;
			goto finish;
		}
	} else {
		if (hash != s) { tbl_result = EN_TBL_STATUS_FAILURE;}
	}
	tbl_close(*file_name);
finish: 
	tbl_schema_check = tbl_result;
	if (fd.ready == NO) { tbl_schema_check = EN_TBL_STATUS_FAILURE;}
	if (tbl_schema_check != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_schema_check);
	}
	return tbl_schema_check;
}

//------------------------------------------------------------------------------
#if TBL_AGGREGATE_HASH
unsigned long tbl_set_md5() {
unsigned long tbl_set_md5;
//Calculate the MD5 of tbl_record_string, store it in the table, and also modify the table hash.

	unsigned int f, i;
	string temp;
	string<TBL_MAX_FIELD_VALUE_LEN> sfldval;
	unsigned char l;
	unsigned long d;
	unsigned int msw, lsw;

	tbl_field_sg("UID",sfldval,EN_TBL_GET);
	temp = chr(TBL_ELEMENT_START)+"I"+chr(TBL_ELEMENT_NAME_VALUE_SEPARATOR)+sfldval+chr(TBL_ELEMENT_END);

	for (f=2; f <= tbl_info(tbl_info_index).num_of_fields-1; f++) {
		i = tbl_info[tbl_info_index].field_num_offset+f;
		if (tbl_field_info[i].field_name == "") { break;}
		if (tbl_field_sg(tbl_field_info[i].field_name,sfldval,EN_TBL_GET) == EN_TBL_STATUS_OK) {
			#if TBL_TIME_TYPE_INCLUDED		
				if (tbl_field_info[i].field_type == `T`) {
					switch (tbl_field_info[i].p1) {
					case EN_TBL_DT_TIME1:
case EN_TBL_DT_TIME2:
case EN_TBL_DT_TIME3:

						sfldval = "20000101"+sfldval;
						td_str_date_time_reformat(sfldval,TD_STR_ADD_FORMATTING,TD_DATE_FORMAT_YYYYMMDD);
						l = len(sfldval);
						sfldval = mid(sfldval,12,l-11);
						break;
					case EN_TBL_DT_DATE:
case EN_TBL_DT_DATE_TIME1:
case EN_TBL_DT_DATE_TIME2:
case EN_TBL_DT_ALL:

						td_str_date_time_reformat(sfldval,TD_STR_ADD_FORMATTING,TD_DATE_FORMAT_YYYYMMDD);
						break;
					}
				}
			#endif
			temp = temp+chr(TBL_ELEMENT_START)+sfldval+chr(TBL_ELEMENT_END);
		}
	}
	sfldval = md5(temp,"",MD5_FINISH,len(temp));
	msw = asc(left(sfldval,1))*256+asc(mid(sfldval,2,1));
	lsw = asc(mid(sfldval,3,1))*256+asc(mid(sfldval,4,1));
	d = msw*65536+lsw;
	sfldval = lstr(d);
	tbl_field_sg("MD5",sfldval,EN_TBL_SET);
	tbl_set_md5 = lval(sfldval);
	return tbl_set_md5;
}
#endif

//------------------------------------------------------------------------------
en_tbl_status_codes tbl_field_find(string field_name, unsigned int *field_index) {
en_tbl_status_codes tbl_field_find;
	unsigned int f, i;

	i = asc(field_name);
	if (i>=0x30 && i<=0x39) {
		i = val(field_name);
		if (i>tbl_info[tbl_info_index].num_of_fields-1) {
			*field_index = tbl_info[tbl_info_index].field_num_offset+i;
			tbl_field_find = EN_TBL_STATUS_UNKNOWN_FIELD;
		} else {
			tbl_field_find = EN_TBL_STATUS_OK;
		}
		return tbl_field_find;
	}

	for (f=0; f <= tbl_info(tbl_info_index).num_of_fields-1; f++) {
		i = tbl_info[tbl_info_index].field_num_offset+f;
		if (tbl_field_info[i].field_name == field_name) {
			*field_index = i;
			tbl_field_find = EN_TBL_STATUS_OK;
			return tbl_field_find;
		}
	}
	tbl_field_find = EN_TBL_STATUS_UNKNOWN_FIELD;
	return tbl_field_find;
}

//------------------------------------------------------------------------------
void tbl_check_for_missing_fields(unsigned int curr_pos, unsigned int line_end_pos) {
	if (curr_pos == 0 || curr_pos>line_end_pos) {
		#if TBL_DEBUG_PRINT
			tbl_debugprint("table preparation filed; missing field");
		#endif
		//one of your descriptor lines has missing fields
	}
}

//------------------------------------------------------------------------------
no_yes tbl_check_key_violation(unsigned int *key_ptr) {
no_yes tbl_check_key_violation;
	unsigned int i;
	string<TBL_MAX_RECORD_SIZE> temp;
	string<TBL_MAX_FIELD_VALUE_LEN> skeyfield, sfldval;
	unsigned char sz, b, daddr_offset, lower_bound;
	unsigned long daddr1, daddr2, dtemp;
	unsigned char fld_pos;

	*key_ptr = 0;
	skeyfield = "";
	fld_pos = 2;

	lower_bound = tbl_info[tbl_info_index].field_num_offset;
	//construct key
	if (tbl_info[tbl_info_index].numkeyf>0) {
		for (i=lower_bound; i <= lower_bound+tbl_info(tbl_info_index).numkeyf-1; i++) {
			sz = tbl_get_field_size(i);
			if (tbl_field_info[i+tbl_fld_offset].field_type == `S`) {
				temp = strgen(sz,chr(val(TBL_NULL)));
				tbl_field_sg(tbl_field_info[i+tbl_fld_offset].field_name,sfldval,EN_TBL_GET);
				b = len(sfldval);
				sfldval = chr(b)+sfldval;
			} else {
				sfldval = mid(tbl_record_string,fld_pos,sz);
			}
			fld_pos = fld_pos+sz;
			if (sfldval == "" || sfldval == temp) { goto tbl_key_violate;}
			skeyfield = skeyfield+sfldval;
		}

		//search for same key
		daddr_offset = 1;//offset for active_flag(1byte)
#if TBL_AGGREGATE_HASH
	daddr_offset = daddr_offset+8;//offset for uid(4bytes) + offset for md5(4bytes)
#endif
	daddr1 = 1+daddr_offset;
find_key: 
		daddr1 = fd.find(daddr1,skeyfield,1,FORWARD,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
		if (daddr1>0) {//check if it's a deleted record
			daddr2 = fd.find(daddr1-daddr_offset,TBL_ACTIVE_FLAG,1,FORWARD,tbl_info[tbl_info_index].rec_size,PL_FD_FIND_EQUAL);
			if (daddr2 == daddr1-daddr_offset) {
				goto tbl_key_violate;
			} else {
				daddr1 = daddr1+tbl_info[tbl_info_index].rec_size;
				goto find_key;
			}
		}
	}
	tbl_check_key_violation = NO;
	return tbl_check_key_violation;
tbl_key_violate: 
	dtemp = tbl_info[tbl_info_index].rec_size;
	dtemp = daddr1/dtemp+1;
	*key_ptr = dtemp;
	tbl_check_key_violation = YES;
	return tbl_check_key_violation;
}

//------------------------------------------------------------------------------
pl_fd_status_codes tbl_attributes_sg(string *tbl_file_name, string<4> attri_name, string *attri_val, en_tbl_rdwr op) {
pl_fd_status_codes tbl_attributes_sg;
	string<29> s;
	string<4> hash;
	string<7> ts;
	string<2> rc;
	string<16> schema;

	if (*tbl_file_name == "") {
		tbl_attributes_sg = PL_FD_STATUS_NOT_FOUND;
		return tbl_attributes_sg;
	}

	s = fd.getattributes(*tbl_file_name);
	rc = mid(s,1,2);
	ts = mid(s,3,7);
	hash = mid(s,10,4);
	schema = mid(s,14,16);

	if (op == EN_TBL_GET) {
		switch (attri_name) {
		case "RC":

			*attri_val = rc;
			break;
		case "TS":

			*attri_val = ts;
			break;
		case "HASH":

			*attri_val = hash;
			break;
		case "SCHM":

			*attri_val = schema;
			break;
		default:
			*attri_val = s;break;
		}
	} else {
		if (rc == "") { rc = strgen(2,chr(TBL_NULL));}
		if (ts == "") { ts = strgen(7,chr(TBL_NULL));}
		if (hash == "") { hash = strgen(4,chr(TBL_NULL));}
		if (schema == "") { schema = strgen(2,chr(TBL_NULL));}

		switch (attri_name) {
		case "RC":

			s = *attri_val+ts+hash+schema;
			break;
		case "TS":

			s = rc+*attri_val+hash+schema;
			break;
		case "HASH":

			s = rc+ts+*attri_val+schema;
			break;
		case "SCHM":

			s = rc+ts+hash+*attri_val;
			break;
		default:
			s = strgen(13,chr(TBL_NULL));break;
		}
		fd.setattributes(*tbl_file_name,s);
	}
	tbl_attributes_sg = fd.laststatus;
	return tbl_attributes_sg;
}

//------------------------------------------------------------------------------
pl_fd_status_codes tbl_active_rc_sg(unsigned int *rec_count, en_tbl_rdwr op) {
pl_fd_status_codes tbl_active_rc_sg;
	string<2> s;
	unsigned char msb, lsb;
	if (op == EN_TBL_GET) {
		tbl_active_rc_sg = tbl_attributes_sg(tbl_selected_file_name,"RC",s,EN_TBL_GET);
		msb = asc(left(s,1));
		lsb = asc(right(s,1));
		*rec_count = msb*256+lsb;
	} else {
		msb = *rec_count/256;
		lsb = *rec_count % 256;
		s = chr(msb)+chr(lsb);
		tbl_active_rc_sg = tbl_attributes_sg(tbl_selected_file_name,"RC",s,EN_TBL_SET);
	}
	return tbl_active_rc_sg;
}

//------------------------------------------------------------------------------
#if TBL_AGGREGATE_HASH
void tbl_mod_hash(unsigned long *d) {
//Update the hash value that is stored in the file attribute.

	unsigned int msw, lsw;
	unsigned long hash_val;
	string<4> hash;

	//read the current table hash from the file attribute
	tbl_attributes_sg(tbl_selected_file_name,"HASH",hash,EN_TBL_GET);

	//calculating new hash value
	msw = asc(left(hash,1))*256+asc(mid(hash,2,1));
	lsw = asc(mid(hash,3,1))*256+asc(mid(hash,4,1));
	hash_val = msw*65536+lsw;
	hash_val = hash_val ^ *d;
	msw = hash_val/65536;
	lsw = hash_val % 65536;
	hash = chr(msw/256)+chr(msw % 256)+chr(lsw/256)+chr(lsw % 256);

	//store the new hash value to the file attribute
	tbl_attributes_sg(tbl_selected_file_name,"HASH",hash,EN_TBL_SET);
}
#endif

//------------------------------------------------------------------------------
#if TBL_AGGREGATE_HASH
en_tbl_status_codes tbl_generate_uid(string *id_string) {
en_tbl_status_codes tbl_generate_uid;

	en_tbl_status_codes result;
	unsigned int msw, lsw;
	long l;

	if (*id_string == "") {
		do {
			*id_string = random(4);
			msw = asc(left(*id_string,1))*256+asc(mid(*id_string,2,1));
			lsw = asc(mid(*id_string,3,1))*256+asc(mid(*id_string,4,1));
			l = msw*65536+lsw;
			if (l<0) { l = l*-1;}
			*id_string = lstri(l);
			result = tbl_field_sg("UID",*id_string,EN_TBL_SET);
		} while (result == EN_TBL_STATUS_KEY_VIOLATION);
	} else {
		result = tbl_field_sg("UID",*id_string,EN_TBL_SET);
	}
	tbl_generate_uid = result;
	if (tbl_generate_uid != EN_TBL_STATUS_OK) {
		callback_tbl_error(tbl_generate_uid);
		#if TBL_DEBUG_PRINT
			tbl_debug_print_error("tbl_generate_uid()",tbl_generate_uid);
		#endif
	}
	return tbl_generate_uid;
}
#endif

//-------------------------------------------------------------
string tbl_get_descriptor_field(unsigned int line_end_pos, unsigned int *field_start_pos) {
string tbl_get_descriptor_field;
//line_end_pos is an INPUT parameter, field_start_pos RETURNS the field position 

	unsigned int i;

	do {
		if (romfile.pointer>=line_end_pos) {
			//the field is missing
			tbl_get_descriptor_field = "";
			*field_start_pos = 0;
			return tbl_get_descriptor_field;
		}

		i = romfile.find(romfile.pointer,chr(TBL_FIELD_SEPARATOR),1);
		*field_start_pos = romfile.pointer;
		if (i == 0 || i>line_end_pos) {
			//no next field separator found on this line, so we assume the field goes to the end of the line
			i = line_end_pos;
			tbl_get_descriptor_field = romfile.getdata(i-romfile.pointer);
			romfile.pointer = line_end_pos+1;
		} else {
			tbl_get_descriptor_field = romfile.getdata(i-romfile.pointer);
			romfile.pointer = i+1;
		}
	} while (tbl_get_descriptor_field == "");
	return tbl_get_descriptor_field;
}

//------------------------------------------------------------------------------
#if TBL_DEBUG_PRINT
void tbl_debug_print_error(string *debug_str, en_tbl_status_codes status_code) {

	string s;

	switch (status_code) {
	case EN_TBL_STATUS_NOT_STARTED:
s = *debug_str+" ERROR: tbl_start() wasn't used or failed.";
	break;
	case EN_TBL_STATUS_OUT_OF_FILE_NUMBERS:
s = *debug_str+" ERROR: Out of file numbers.";
	break;
	case EN_TBL_STATUS_FAILURE:
s = *debug_str+" ERROR: Flash disk is not ready or disk operation has failed.";
	break;
	case EN_TBL_STATUS_UNKNOWN_TABLE:
s = *debug_str+" ERROR: Unknown table.";
	break;
	case EN_TBL_STATUS_UNKNOWN_FIELD:
s = *debug_str+" ERROR: Unknown field.";
	break;
	case EN_TBL_STATUS_UNKNOWN_FILE:
s = *debug_str+" ERROR: Unknown data file or no data file was selected.";
	break;
	case EN_TBL_STATUS_INVALID:
s = *debug_str+" ERROR: Invalid field value.";
	break;
	case EN_TBL_STATUS_FULL:
s = *debug_str+" ERROR: Max record number reached or the flash disk is full.";
	break;
	case EN_TBL_STATUS_NOT_FOUND:
s = *debug_str+" Record not found.";
	break;
	case EN_TBL_STATUS_KEY_VIOLATION:
s = *debug_str+" ERROR: Key field violation.";
	break;
	case EN_TBL_STATUS_DELETED:
s = *debug_str+" ERROR: This record is deleted (not active).";
	break;
	case EN_TBL_STATUS_END_OF_TABLE:
s = *debug_str+" End of table.";
	break;
	case EN_TBL_STATUS_INV_PARAM:
s = *debug_str+" ERROR: Invalid parameter.";
	break;
	}
	tbl_debugprint(s);
}
#endif

//------------------------------------------------------------------------------
#if TBL_DEBUG_PRINT
void tbl_debugprint(string *print_data) {
	if (tbl_do_not_debug_print == NO) { sys.debugprint(TBL_STAMP+*print_data+TBL_CR_LF);}
}
#endif

void tbl_set_to_clean_start(no_yes op) {
	tbl_info[tbl_info_index].clean_start = op;
}
