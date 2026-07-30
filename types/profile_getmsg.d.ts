export interface ProfileGetMsgResponse {
  ret: number;
  errmsg: string;
  can_msg_continue: number;
  msg_count: number;
  next_offset: number;
  real_type: number;
  use_video_tab: number;
  video_count: number;
  general_msg_list: string;
}

export interface ProfileGetMsgAppMsgItem {
  audio_fileid?: number;
  author?: string;
  content?: string;
  content_url?: string;
  copyright_stat?: number;
  cover?: string;
  del_flag?: number;
  digest?: string;
  duration?: number;
  fileid?: number;
  is_pay_subscribe?: number;
  item_show_type?: number;
  malicious_content_type?: number;
  malicious_title_reason_id?: number;
  play_url?: string;
  source_url?: string;
  title?: string;
}

export interface ProfileGetMsgAppMsgExtInfo extends ProfileGetMsgAppMsgItem {
  subtype?: number;
  is_multi?: number;
  multi_app_msg_item_list?: ProfileGetMsgAppMsgItem[];
}

export interface ProfileGetMsgCommMsgInfo {
  content?: string;
  datetime: number;
  fakeid?: string;
  id: number;
  status?: number;
  type?: number;
}

export interface ParsedProfileGetMsg {
  app_msg_ext_info?: ProfileGetMsgAppMsgExtInfo;
  comm_msg_info: ProfileGetMsgCommMsgInfo;
}

export interface ParsedProfileGetMsgList {
  list?: ParsedProfileGetMsg[];
}
