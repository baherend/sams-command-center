-- =====================================================================
-- FICTITIOUS sample data for testing the CRDC portal and dashboard.
-- No real names, IDs, e-mails or documents. Researchers are "باحث تجريبي NNN",
-- e-mails end with @example.test, IDs start with TEST-.
-- Dates are relative to now(); the generator is seeded, so counts are repeatable.
-- Run after 01 and 02. To remove it: delete from the tables in reverse order.
-- =====================================================================
begin;
do $$
declare
  rs record; k int; v_req bigint; v_created timestamptz; v_age int; v_paid int; v_pages int;
  v_type text; v_opts text[]; v_opt text; v_optc text; v_svc smallint; v_fee smallint;
  v_items bigint[]; v_item bigint; v_ev_s smallint[]; v_ev_d int[]; s4 int; c int; v_pub boolean;
  v_pay bigint; v_cashier uuid; v_staff uuid; v_final smallint; v_seq int := 0; v_pseq int := 0;
  v_journal smallint; v_i int;
begin
  perform setseed(0.42);
  insert into crdc.staff_users (full_name, role) values
    ('موظف تجريبي 1','admin'),('موظف تجريبي 2','reviewer'),('موظف تجريبي 3','reviewer'),
    ('موظف تجريبي 4','statistician'),('موظف تجريبي 5','cashier');
  select staff_id into v_cashier from crdc.staff_users where role = 'cashier';

  insert into crdc.researchers (full_name, applicant_type, nationality, national_id, passport_no,
                                degree_id, specialty, email, created_at)
  select 'باحث تجريبي ' || lpad(g::text,3,'0'),
         case when g % 4 = 0 then 'foreign' else 'egyptian' end,
         case when g % 4 = 0 then 'Testland-' || chr(65 + g % 3) end,
         case when g % 4 <> 0 then 'TEST-N-' || lpad(g::text,4,'0') end,
         case when g % 4 = 0 then 'TEST-P-' || lpad(g::text,4,'0') end,
         case when g % 10 in (0,1,2) then 1 when g % 10 in (3,4,5,6) then 2 when g % 10 = 7 then 3 else 4 end,
         (array['إدارة أعمال','محاسبة','اقتصاد','تمويل','موارد بشرية'])[1 + g % 5],
         'researcher' || lpad(g::text,3,'0') || '@example.test',
         now() - interval '400 days' + make_interval(hours => g)
  from generate_series(1, 80) g;

  for rs in select researcher_id, applicant_type, degree_id from crdc.researchers order by email loop
    for k in 1..3 loop
      v_opts := '{}';
      if rs.degree_id in (3,4) then
        exit when k > 1;
        v_type := 'thesis'; v_pages := 90 + (random()*90)::int;
        v_opts := array[case when random() < 0.4 then 'DT_COURSE_EXAM' else 'DT_EXAM_ONLY' end];
      elsif k = 1 then
        v_type := 'thesis'; v_pages := 90 + (random()*90)::int;
        if random() < 0.85 then v_opts := v_opts || (case when random() < 0.7 then 'LANG_AR' else 'LANG_EN' end); end if;
        if random() < 0.80 then v_opts := v_opts || 'STAT_REVIEW'::text; end if;
        if random() < 0.55 then v_opts := v_opts || 'STAT_ANALYSIS'::text; end if;
        if random() < 0.90 then v_opts := v_opts || 'PLAG'::text; end if;
        if random() < 0.70 then v_opts := v_opts || (case when random() < 0.4 then 'DT_COURSE_EXAM' else 'DT_EXAM_ONLY' end); end if;
        if cardinality(v_opts) = 0 then v_opts := array['PLAG']; end if;
      elsif (k = 2 and random() < 0.70) or (k = 3 and rs.degree_id = 1 and random() < 0.40) then
        v_type := 'paper'; v_pages := 18 + (random()*14)::int;
        v_opts := array['PUB_ARBITRATION','PUB_PUBLISH'];
      else
        continue;
      end if;

      v_age := case when v_type = 'thesis' then 5 + (random()*325)::int else 3 + (random()*300)::int end;
      v_created := now() - make_interval(days => v_age, hours => (random()*8)::int);
      v_seq := v_seq + 1;
      insert into crdc.service_requests (researcher_id, work_type, work_title, page_count, created_at)
      values (rs.researcher_id, v_type,
              case when v_type = 'thesis' then 'رسالة تجريبية ' else 'بحث تجريبي ' end || lpad(v_seq::text,3,'0'),
              v_pages, v_created)
      returning request_id into v_req;

      v_items := '{}';
      foreach v_opt in array v_opts loop
        select fee_id into v_fee from crdc.fee_schedule
         where option_code = v_opt and applicant_type = rs.applicant_type;
        insert into crdc.request_items (request_id, fee_id, status_id, amount_due, created_at)
        values (v_req, v_fee, 1, crdc.calc_fee(v_fee, v_pages), v_created)
        returning item_id into v_item;
        v_items := v_items || v_item;
      end loop;

      v_paid := 2 + (random()*2)::int;
      if v_age >= v_paid then
        v_pseq := v_pseq + 1;
        insert into crdc.payments (request_id, payment_order_no, receipt_no, amount, currency, channel, paid_at)
        select v_req, 'PO-TEST-' || lpad(v_pseq::text,5,'0'), 'RC-TEST-' || lpad(v_pseq::text,5,'0'),
               sum(amount_due), max(currency),
               case when rs.applicant_type = 'egyptian' then 'treasury' else 'bank' end,
               (v_created + make_interval(days => v_paid))::date
        from crdc.request_items where request_id = v_req
        returning payment_id into v_pay;
        update crdc.request_items set payment_id = v_pay where request_id = v_req;
      end if;

      foreach v_item in array v_items loop
        select f.option_code, f.service_id into v_optc, v_svc
          from crdc.request_items i join crdc.fee_schedule f using (fee_id) where i.item_id = v_item;
        v_pub := (v_svc = 1);
        s4 := v_paid + 1 + (random())::int;
        v_ev_s := array[2,3,4]::smallint[];
        v_ev_d := array[1, v_paid, s4];
        if v_pub and random() < 0.35 then
          v_ev_s := v_ev_s || array[5,4]::smallint[];
          v_ev_d := v_ev_d || array[s4 + 6, s4 + 9];
          c := s4 + 9 + 5 + (random()*10)::int;
        elsif v_pub then
          c := s4 + 10 + (random()*20)::int;
        else
          c := s4 + 3 + (random()*14)::int;
        end if;
        v_ev_s := v_ev_s || array[6,7]::smallint[];
        v_ev_d := v_ev_d || array[c, c + 1 + (random()*2)::int];

        select staff_id into v_staff from crdc.staff_users
         where role = case when v_svc = 3 then 'statistician' else 'reviewer' end
         order by random() limit 1;

        for v_i in 1..cardinality(v_ev_s) loop
          exit when v_ev_d[v_i] > v_age;
          insert into crdc.request_status_history (item_id, status_id, changed_at, changed_by)
          values (v_item, v_ev_s[v_i], v_created + make_interval(days => v_ev_d[v_i]),
                  case when v_ev_s[v_i] in (2,3) then v_cashier else v_staff end);
        end loop;

        select status_id into v_final from crdc.request_items where item_id = v_item;
        if v_final >= 4 then
          update crdc.request_items set assigned_staff_id = v_staff where item_id = v_item;
        end if;
        if v_final >= 4 and v_optc = 'PUB_PUBLISH' then
          v_journal := 1 + (random())::int;
          insert into crdc.publication_submissions (item_id, journal_id, issue_id, paper_language, decision, accepted_at)
          values (v_item, v_journal,
                  (select issue_id from crdc.journal_issues where journal_id = v_journal order by random() limit 1),
                  case when random() < 0.75 then 'ar' else 'en' end,
                  case v_final when 4 then 'pending' when 5 then 'revisions' else 'accepted' end,
                  case when v_final >= 6 then
                    (select changed_at::date from crdc.request_status_history
                      where item_id = v_item and status_id = 6 order by changed_at desc limit 1) end);
        end if;
      end loop;
    end loop;
  end loop;
end $$;
commit;
