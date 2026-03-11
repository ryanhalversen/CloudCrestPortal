// force-app/main/default/classes/CommandCenterController.cls
public with sharing class CommandCenterController {

    // ── Wrapper Classes ───────────────────────────────────────────────────────

    public class KPI {
        @AuraEnabled public String label;
        @AuraEnabled public String value;
        @AuraEnabled public String trend; // 'up', 'down', 'neutral'
        @AuraEnabled public String sub;
    }

    public class ChartDataset {
        @AuraEnabled public String        label;
        @AuraEnabled public List<Decimal> data;
        @AuraEnabled public String        color;
        @AuraEnabled public List<String>  colors;      // per-slice (doughnut)
        @AuraEnabled public String        borderColor;
        @AuraEnabled public Boolean       isDashed;
    }

    public class Benchmark {
        @AuraEnabled public String poor;
        @AuraEnabled public String good;
        @AuraEnabled public String great;
    }

    public class CardData {
        @AuraEnabled public String             title;
        @AuraEnabled public String             subtitle;
        @AuraEnabled public String             question;  // The key question this card answers
        @AuraEnabled public String             status;    // 'good','warning','critical','neutral'
        @AuraEnabled public Benchmark          benchmarks;
        @AuraEnabled public List<KPI>          kpis;
        @AuraEnabled public String             chartType; // 'bar','line','doughnut'
        @AuraEnabled public List<String>       chartLabels;
        @AuraEnabled public List<ChartDataset> datasets;
        @AuraEnabled public List<String>       insights;
    }

    // ── Private Helpers ───────────────────────────────────────────────────────

    private static KPI kpi(String lbl, String val, String trend, String sub) {
        KPI k = new KPI();
        k.label = lbl; k.value = val; k.trend = trend; k.sub = sub;
        return k;
    }

    private static Benchmark bm(String poor, String good, String great) {
        Benchmark b = new Benchmark();
        b.poor = poor; b.good = good; b.great = great;
        return b;
    }

    private static ChartDataset ds(String lbl, List<Decimal> data, String color) {
        ChartDataset d = new ChartDataset();
        d.label = lbl; d.data = data; d.color = color; d.borderColor = color;
        return d;
    }

    // Converts minutes → "X.Xh" string
    private static String hrs(Decimal minutes) {
        if (minutes == null || minutes <= 0) return '0h';
        return (minutes / 60).setScale(1, RoundingMode.HALF_UP) + 'h';
    }

    private static String weekLabel(Date d) {
        return d.month() + '/' + d.day();
    }

    // ── Row 1: Past ───────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static CardData getPastManagement() {
        Date w4Ago = Date.today().addDays(-28);
        Date ws    = Date.today().toStartOfWeek();

        // Sum minutes per day → bucket into weeks
        Map<Date, Decimal> byWeek = new Map<Date, Decimal>();
        for (AggregateResult ar : [
            SELECT Logged_Date__c dt, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  Logged_Date__c >= :w4Ago
            GROUP BY Logged_Date__c
        ]) {
            Date day  = (Date) ar.get('dt');
            Decimal m = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            Date wk   = day.toStartOfWeek();
            byWeek.put(wk, (byWeek.containsKey(wk) ? byWeek.get(wk) : 0) + m);
        }

        List<String>  labels   = new List<String>();
        List<Decimal> data     = new List<Decimal>();
        Decimal       totalMins = 0;
        for (Integer i = 3; i >= 0; i--) {
            Date wk = ws.addDays(-i * 7);
            labels.add(weekLabel(wk));
            Decimal m = byWeek.containsKey(wk) ? byWeek.get(wk) : 0;
            totalMins += m;
            data.add((m / 60).setScale(1, RoundingMode.HALF_UP));
        }

        Integer completed = [
            SELECT COUNT() FROM Case
            WHERE  Status IN ('Completed','Closed')
              AND  LastModifiedDate >= :DateTime.newInstance(w4Ago, Time.newInstance(0,0,0,0))
        ];
        Integer onTrack   = [SELECT COUNT() FROM Sprint__c WHERE Status__c = 'In Progress' AND Pace_Status__c = 'On Track'];
        Integer totalProj = [SELECT COUNT() FROM Sprint__c WHERE Status__c = 'In Progress'];

        Integer pct    = totalProj > 0 ? (onTrack * 100) / totalProj : 0;
        String  status = totalProj == 0 ? 'neutral' : pct >= 70 ? 'good' : pct >= 40 ? 'warning' : 'critical';

        CardData cd = new CardData();
        cd.title    = 'Delivery Performance';
        cd.subtitle = 'Last 4 Weeks';
        cd.question    = 'Did we deliver at pace?';
        cd.status      = status;
        cd.benchmarks  = bm('< 60h/wk avg', '60–90h/wk avg', '> 90h/wk avg');
        cd.kpis = new List<KPI>{
            kpi('Hours Logged',      hrs(totalMins),             'neutral',                     '4-week total'),
            kpi('Stories Closed',    String.valueOf(completed),  'neutral',                     '4-week total'),
            kpi('Projects On Track', onTrack + '/' + totalProj, pct >= 70 ? 'up' : 'down',    'active projects')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hours', data, '#00b4d8') };
        cd.insights    = new List<String>{
            'Team logged ' + hrs(totalMins) + ' over 4 weeks (' + hrs(totalMins / 4) + '/wk avg)',
            completed + ' stories completed or closed in the period',
            onTrack + ' of ' + totalProj + ' active projects currently on track'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPastCustomer() {
        Date w4Ago = Date.today().addDays(-28);

        // Step 1 — aggregate hours by project ID
        Map<String, Decimal> projMins = new Map<String, Decimal>();
        for (AggregateResult ar : [
            SELECT Case__r.Projects__c pid, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  Logged_Date__c    >= :w4Ago
              AND  Case__r.Projects__c != null
            GROUP BY Case__r.Projects__c
            ORDER BY SUM(Minutes_Logged__c) DESC
            LIMIT  8
        ]) {
            String  pid = (String)  ar.get('pid');
            Decimal m   = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            projMins.put(pid, m);
        }

        // Step 2 — look up project names
        Map<String, String> projNames = new Map<String, String>();
        for (Sprint__c s : [
            SELECT Id, Name FROM Sprint__c WHERE Id IN :projMins.keySet()
        ]) {
            projNames.put(s.Id, s.Name);
        }

        List<String>  labels   = new List<String>();
        List<Decimal> data     = new List<Decimal>();
        Decimal       totalMins = 0;
        for (String pid : projMins.keySet()) {
            String lbl = projNames.containsKey(pid) ? projNames.get(pid) : 'Unknown';
            labels.add(lbl.length() > 18 ? lbl.substring(0, 18) + '…' : lbl);
            Decimal m = projMins.get(pid);
            data.add((m / 60).setScale(1, RoundingMode.HALF_UP));
            totalMins += m;
        }

        Integer activeProjects = projMins.size();
        Decimal avgPerProj     = activeProjects > 0 ? totalMins / activeProjects : 0;

        CardData cd = new CardData();
        cd.title    = 'Client Billing';
        cd.subtitle = 'Last 4 Weeks';
        cd.question   = 'Who did we bill and how much?';
        cd.status     = totalMins > 0 ? 'good' : 'warning';
        cd.benchmarks = bm('< 40h billed', '40–80h billed', '> 80h billed');
        cd.kpis = new List<KPI>{
            kpi('Billable Hours',   hrs(totalMins),              'neutral', '4-week total'),
            kpi('Active Projects',  String.valueOf(activeProjects), 'neutral', 'with time logged'),
            kpi('Avg / Project',    hrs(avgPerProj),             'neutral', '4-week avg')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hours', data, '#0096c7') };
        cd.insights    = new List<String>{
            hrs(totalMins) + ' billed across ' + activeProjects + ' projects in 4 weeks',
            labels.isEmpty() ? 'No billing data available' : 'Top project: ' + labels[0] + ' (' + (data.isEmpty() ? '0' : String.valueOf(data[0])) + 'h)',
            'Average ' + hrs(avgPerProj) + ' per project this period'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPastEmployee() {
        Date w4Ago = Date.today().addDays(-28);

        List<String>  labels   = new List<String>();
        List<Decimal> data     = new List<Decimal>();
        Decimal       totalMins = 0;

        for (AggregateResult ar : [
            SELECT CreatedBy.Name nm, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  Logged_Date__c >= :w4Ago
            GROUP BY CreatedBy.Name
            ORDER BY SUM(Minutes_Logged__c) DESC
            LIMIT  10
        ]) {
            String  nm = (String)  ar.get('nm');
            Decimal m  = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            labels.add(nm);
            data.add((m / 60).setScale(1, RoundingMode.HALF_UP));
            totalMins += m;
        }

        Decimal contractorWeeklyHrs = 0;
        for (Contact c : [
            SELECT Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            contractorWeeklyHrs += c.Available_Hours__c;
        }
        Decimal capacityMins = contractorWeeklyHrs * 60 * 4;
        Integer utilPct = capacityMins > 0
            ? Integer.valueOf(((totalMins / capacityMins) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;

        CardData cd = new CardData();
        cd.title    = 'Team Utilization';
        cd.subtitle = 'Last 4 Weeks';
        cd.question   = 'Did the team work at full capacity?';
        cd.status     = utilPct >= 75 ? 'good' : utilPct >= 50 ? 'warning' : 'critical';
        cd.benchmarks = bm('< 50% utilized', '50–75% utilized', '> 75% utilized');
        cd.kpis = new List<KPI>{
            kpi('Team Total',    hrs(totalMins),              'neutral',                  '4-week total'),
            kpi('Utilization',   utilPct + '%',               utilPct >= 70 ? 'up' : 'down', 'vs contractor cap'),
            kpi('Contributors',  String.valueOf(labels.size()), 'neutral',                 'active members')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hours', data, '#0077b6') };
        cd.insights    = new List<String>{
            labels.isEmpty() ? 'No time logged in period' : 'Top contributor: ' + labels[0] + ' (' + (data.isEmpty() ? '0' : String.valueOf(data[0])) + 'h)',
            utilPct + '% contractor utilization vs available capacity',
            hrs(totalMins / 4) + ' average team output per week over 4 weeks'
        };
        return cd;
    }

    // ── Row 2: Present ────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static CardData getPresentManagement() {
        Map<String, Integer> sCounts = new Map<String, Integer>();
        Integer total = 0;
        for (AggregateResult ar : [
            SELECT Status s, COUNT(Id) c
            FROM   Case
            WHERE  Status NOT IN ('Cancelled','Completed','Closed')
            GROUP BY Status
        ]) {
            String  s = (String)  ar.get('s');
            Integer c = (Integer) ar.get('c');
            sCounts.put(s, c);
            total += c;
        }

        Integer wip     = sCounts.containsKey('Work In Progress (WIP)') ? sCounts.get('Work In Progress (WIP)') : 0;
        Integer blocked = sCounts.containsKey('Blocked')    ? sCounts.get('Blocked')    : 0;
        Integer review  = sCounts.containsKey('In Review')  ? sCounts.get('In Review')  : 0;

        List<String>  statusKeys   = new List<String>{ 'Work In Progress (WIP)', 'Blocked', 'In Review', 'In UAT', 'New', 'Scheduled', 'Waiting for User', 'Backlog', 'On Hold' };
        List<String>  statusLabels = new List<String>{ 'WIP', 'Blocked', 'In Review', 'In UAT', 'New', 'Scheduled', 'Waiting', 'Backlog', 'On Hold' };
        List<String>  statusColors = new List<String>{ '#00b4d8', '#ef4444', '#0096c7', '#0077b6', '#caf0f8', '#ade8f4', '#48cae4', '#023e5a', '#012a3d' };
        List<Decimal> slices       = new List<Decimal>();
        for (String k : statusKeys) {
            slices.add(sCounts.containsKey(k) ? sCounts.get(k) : 0);
        }

        ChartDataset donut   = new ChartDataset();
        donut.label          = 'Stories';
        donut.data           = slices;
        donut.colors         = statusColors;
        donut.borderColor    = '#1e293b';

        CardData cd = new CardData();
        cd.title    = 'Story Pipeline';
        cd.subtitle = 'Active Stories by Status';
        cd.question   = 'What\'s blocking delivery right now?';
        cd.status     = blocked > 5 ? 'critical' : blocked > 2 ? 'warning' : 'good';
        cd.benchmarks = bm('> 5 blocked', '1–5 blocked', '0 blocked');
        cd.kpis = new List<KPI>{
            kpi('In Progress',  String.valueOf(wip),     'neutral',                          'stories'),
            kpi('Blocked',      String.valueOf(blocked), blocked > 0 ? 'down' : 'neutral',  'need attention'),
            kpi('Total Active', String.valueOf(total),   'neutral',                          'across all stages')
        };
        cd.chartType   = 'doughnut';
        cd.chartLabels = statusLabels;
        cd.datasets    = new List<ChartDataset>{ donut };
        cd.insights    = new List<String>{
            total + ' active stories across ' + sCounts.size() + ' status stages',
            blocked > 0 ? blocked + ' blocked stories need immediate attention' : 'No blocked stories — pipeline is flowing',
            review + ' stories currently in review — prioritize sign-off'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPresentCustomer() {
        List<Sprint__c> projects = [
            SELECT Id, Name, Pace_Status__c,
                   Contracted_Hours_Sprint__c, Hours_Delivered__c,
                   Accountlu__r.Name
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
            ORDER BY Pace_Status__c NULLS LAST, Name
            LIMIT  15
        ];

        Integer onTrack = 0, atRisk = 0, critical = 0;
        List<String>  labels     = new List<String>();
        List<Decimal> contracted = new List<Decimal>();
        List<Decimal> delivered  = new List<Decimal>();

        for (Sprint__c s : projects) {
            String ps = s.Pace_Status__c != null ? s.Pace_Status__c : '';
            if      (ps == 'On Track')                  onTrack++;
            else if (ps == 'At Risk')                   atRisk++;
            else if (ps == 'Critical' || ps == 'Behind') critical++;

            String lbl = s.Accountlu__r?.Name != null ? s.Accountlu__r.Name : s.Name;
            labels.add(lbl.length() > 16 ? lbl.substring(0, 16) + '…' : lbl);
            contracted.add(s.Contracted_Hours_Sprint__c != null ? s.Contracted_Hours_Sprint__c : 0);
            delivered.add(s.Hours_Delivered__c != null ? s.Hours_Delivered__c : 0);
        }

        CardData cd = new CardData();
        cd.title    = 'Project Health';
        cd.subtitle = 'Active Projects';
        cd.question   = 'Are client projects on track?';
        cd.status     = critical > 0 ? 'critical' : atRisk > 0 ? 'warning' : 'good';
        cd.benchmarks = bm('Any critical', 'Some at risk', 'All on track');
        cd.kpis = new List<KPI>{
            kpi('On Track',  String.valueOf(onTrack),  'up',                          'projects'),
            kpi('At Risk',   String.valueOf(atRisk),   atRisk   > 0 ? 'down' : 'neutral', 'projects'),
            kpi('Critical',  String.valueOf(critical), critical > 0 ? 'down' : 'neutral', 'projects')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{
            ds('Contracted', contracted, '#90e0ef'),
            ds('Delivered',  delivered,  '#0096c7')
        };
        cd.insights = new List<String>{
            projects.size() + ' active projects under delivery management',
            critical > 0 ? critical + ' project(s) critical — immediate intervention needed' : 'No critical projects',
            atRisk   > 0 ? atRisk   + ' project(s) at risk — review and adjust pacing'       : 'All tracked projects on track'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPresentEmployee() {
        Date weekStart = Date.today().toStartOfWeek();

        List<String>  labels    = new List<String>();
        List<Decimal> loggedH   = new List<Decimal>();
        Decimal       totalLogged = 0;

        for (AggregateResult ar : [
            SELECT CreatedBy.Name nm, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  Logged_Date__c >= :weekStart
            GROUP BY CreatedBy.Name
            ORDER BY SUM(Minutes_Logged__c) DESC
            LIMIT  10
        ]) {
            String  nm = (String)  ar.get('nm');
            Decimal m  = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            labels.add(nm);
            loggedH.add((m / 60).setScale(1, RoundingMode.HALF_UP));
            totalLogged += m;
        }

        Decimal totalCapHrs = 0;
        for (Contact c : [
            SELECT Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            totalCapHrs += c.Available_Hours__c;
        }

        Integer utilPct   = totalCapHrs > 0
            ? Integer.valueOf((((totalLogged / 60) / totalCapHrs) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;
        Decimal available = totalCapHrs - (totalLogged / 60);

        CardData cd = new CardData();
        cd.title    = 'Weekly Utilization';
        cd.subtitle = 'This Week (Mon–Today)';
        cd.question   = 'Is capacity being used this week?';
        cd.status     = utilPct >= 75 ? 'good' : utilPct >= 40 ? 'warning' : 'critical';
        cd.benchmarks = bm('< 40% of capacity', '40–75% of capacity', '> 75% of capacity');
        cd.kpis = new List<KPI>{
            kpi('Logged This Week', hrs(totalLogged),             'neutral',                  'hours'),
            kpi('Utilization',      utilPct + '%',                utilPct >= 70 ? 'up' : 'down', 'of capacity'),
            kpi('Capacity Left',    hrs(available * 60), available > 0 ? 'neutral' : 'down', 'hours remaining')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hours This Week', loggedH, '#48cae4') };
        cd.insights    = new List<String>{
            hrs(totalLogged) + ' logged by ' + labels.size() + ' team members so far this week',
            utilPct + '% of total contractor capacity utilized this week',
            available > 0 ? hrs(available * 60) + ' contractor capacity remains available' : 'Team fully allocated this week'
        };
        return cd;
    }

    // ── Row 3: Future ─────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static CardData getFutureManagement() {
        Date ws = Date.today().toStartOfWeek();

        List<Sprint__c> projects = [
            SELECT Name, On_Time_Weekly_Pace__c, Project_End_Date__c
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
              AND  On_Time_Weekly_Pace__c > 0
        ];

        Decimal contractorCap = 0;
        for (Contact c : [
            SELECT Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            contractorCap += c.Available_Hours__c;
        }
        Decimal totalCap = 105 + contractorCap; // 3 FTEs × 35h + contractors

        List<String>  labels     = new List<String>();
        List<Decimal> demandData = new List<Decimal>();
        List<Decimal> capLine    = new List<Decimal>();
        Decimal       next4Demand = 0;

        for (Integer i = 0; i < 8; i++) {
            Date wk = ws.addDays(i * 7);
            labels.add(weekLabel(wk));
            Decimal d = 0;
            for (Sprint__c s : projects) {
                if (s.Project_End_Date__c == null || wk <= s.Project_End_Date__c) {
                    d += s.On_Time_Weekly_Pace__c != null ? s.On_Time_Weekly_Pace__c : 0;
                }
            }
            demandData.add(d.setScale(1, RoundingMode.HALF_UP));
            capLine.add(totalCap);
            if (i < 4) next4Demand += d;
        }

        Decimal avgDemand = (next4Demand / 4).setScale(1, RoundingMode.HALF_UP);
        Decimal surplus   = (totalCap - avgDemand).setScale(1, RoundingMode.HALF_UP);

        ChartDataset demDs = ds('Demand',   demandData, '#f59e0b');
        ChartDataset capDs = ds('Capacity', capLine,    '#0e7490');
        capDs.isDashed = true;

        CardData cd = new CardData();
        cd.title    = 'Demand Forecast';
        cd.subtitle = 'Next 8 Weeks';
        cd.question   = 'Will capacity cover upcoming demand?';
        cd.status     = surplus < -10 ? 'critical' : surplus < 0 ? 'warning' : 'good';
        cd.benchmarks = bm('> 10h over cap', 'Within 10h of cap', '10h+ surplus');
        cd.kpis = new List<KPI>{
            kpi('4-Wk Avg Demand', avgDemand + 'h/wk', 'neutral',                  'projected weekly'),
            kpi('Team Capacity',   totalCap  + 'h/wk', 'neutral',                  'FTE + contractors'),
            kpi('Weekly Balance',  (surplus >= 0 ? '+' : '') + surplus + 'h', surplus >= 0 ? 'up' : 'down', surplus >= 0 ? 'surplus' : 'over capacity')
        };
        cd.chartType   = 'line';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ demDs, capDs };
        cd.insights    = new List<String>{
            'Projected avg demand of ' + avgDemand + 'h/week over next 4 weeks',
            surplus >= 0 ? 'Capacity surplus of ' + surplus + 'h/week — room to grow' : 'Team over capacity by ' + Math.abs(surplus) + 'h/wk — review resourcing',
            projects.size() + ' active projects contributing to demand forecast'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getFutureCustomer() {
        Date today = Date.today();
        Date d30   = today.addDays(30);
        Date d60   = today.addDays(60);

        List<Sprint__c> upcoming = [
            SELECT Name, Project_End_Date__c, Contracted_Hours_Sprint__c,
                   Hours_Delivered__c, Pace_Status__c, Accountlu__r.Name
            FROM   Sprint__c
            WHERE  Status__c          = 'In Progress'
              AND  Project_End_Date__c != null
              AND  Project_End_Date__c >= :today
            ORDER BY Project_End_Date__c ASC
            LIMIT  12
        ];

        Integer in30 = 0, in3160 = 0;
        List<String>  labels = new List<String>();
        List<Decimal> remHrs = new List<Decimal>();

        for (Sprint__c s : upcoming) {
            if      (s.Project_End_Date__c <= d30) in30++;
            else if (s.Project_End_Date__c <= d60) in3160++;

            String lbl = s.Accountlu__r?.Name != null ? s.Accountlu__r.Name : s.Name;
            labels.add(lbl.length() > 16 ? lbl.substring(0, 16) + '…' : lbl);
            Decimal rem = Math.max(
                (s.Contracted_Hours_Sprint__c != null ? s.Contracted_Hours_Sprint__c : 0)
                - (s.Hours_Delivered__c != null ? s.Hours_Delivered__c : 0), 0);
            remHrs.add(rem);
        }

        CardData cd = new CardData();
        cd.title    = 'Upcoming Deliverables';
        cd.subtitle = 'Project End Dates';
        cd.question   = 'Which client deadlines are approaching?';
        cd.status     = in30 > 2 ? 'critical' : in30 > 0 ? 'warning' : 'good';
        cd.benchmarks = bm('3+ due in 30 days', '1–2 due in 30 days', '0 due in 30 days');
        cd.kpis = new List<KPI>{
            kpi('Due ≤ 30 Days',  String.valueOf(in30),    in30   > 0 ? 'down' : 'neutral', 'projects'),
            kpi('Due 31–60 Days', String.valueOf(in3160),  'neutral',                        'projects'),
            kpi('Total Tracked',  String.valueOf(upcoming.size()), 'neutral',               'active projects')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Remaining Hours', remHrs, '#f59e0b') };
        cd.insights    = new List<String>{
            in30   > 0 ? in30   + ' project(s) due within 30 days — verify delivery pace' : 'No projects due within 30 days',
            in3160 > 0 ? in3160 + ' project(s) due in 31–60 day window — monitor closely'  : 'No projects due in 31–60 day window',
            upcoming.size() + ' active projects with defined end dates being tracked'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getFutureEmployee() {
        List<String>  labels    = new List<String>();
        List<Decimal> available = new List<Decimal>();
        Decimal totalContractor = 0;

        for (Contact c : [
            SELECT Name, Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
            ORDER BY Name ASC
            LIMIT  10
        ]) {
            labels.add(c.Name);
            available.add(c.Available_Hours__c);
            totalContractor += c.Available_Hours__c;
        }

        Decimal fteHrs   = 105;
        Decimal totalHrs = fteHrs + totalContractor;

        // Next-week demand
        Date nextWeek = Date.today().toStartOfWeek().addDays(7);
        Decimal weeklyDemand = 0;
        for (Sprint__c s : [
            SELECT On_Time_Weekly_Pace__c, Project_End_Date__c
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
              AND  On_Time_Weekly_Pace__c > 0
        ]) {
            if (s.Project_End_Date__c == null || s.Project_End_Date__c >= nextWeek) {
                weeklyDemand += s.On_Time_Weekly_Pace__c != null ? s.On_Time_Weekly_Pace__c : 0;
            }
        }

        Decimal surplus = (totalHrs - weeklyDemand).setScale(1, RoundingMode.HALF_UP);

        CardData cd = new CardData();
        cd.title    = 'Capacity Planning';
        cd.subtitle = 'Contractor Availability';
        cd.question   = 'Do we have bandwidth for what\'s ahead?';
        cd.status     = surplus < -10 ? 'critical' : surplus < 0 ? 'warning' : 'good';
        cd.benchmarks = bm('> 10h deficit', 'Within 10h of demand', '10h+ surplus');
        cd.kpis = new List<KPI>{
            kpi('Contractor Hrs', hrs(totalContractor * 60), 'neutral',                  'per week total'),
            kpi('Full Team Cap',  hrs(totalHrs * 60),        'neutral',                  'FTE + contractors/wk'),
            kpi('vs Demand',      (surplus >= 0 ? '+' : '') + surplus + 'h', surplus >= 0 ? 'up' : 'down', surplus >= 0 ? 'surplus' : 'over capacity')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hrs / Week', available, '#0077b6') };
        cd.insights    = new List<String>{
            hrs(totalContractor * 60) + '/week in contractor capacity across ' + labels.size() + ' contractors',
            hrs(fteHrs * 60) + '/week FTE team (3 × 35h) + ' + hrs(totalContractor * 60) + ' contractor',
            surplus >= 0 ? surplus + 'h/week surplus against next-week demand' : Math.abs(surplus) + 'h/week capacity deficit next week'
        };
        return cd;
    }
}
