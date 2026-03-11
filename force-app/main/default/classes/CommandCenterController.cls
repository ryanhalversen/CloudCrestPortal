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

        // Contractor capacity (weekly hours × 4 weeks, in minutes)
        Decimal contractorWeeklyHrs = 0;
        for (Contact c : [
            SELECT Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            contractorWeeklyHrs += c.Available_Hours__c;
        }
        Decimal capacityMins = contractorWeeklyHrs * 60 * 4;

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

        Integer utilPct = capacityMins > 0
            ? Integer.valueOf(((totalMins / capacityMins) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;

        Integer onTrack   = [SELECT COUNT() FROM Sprint__c WHERE Status__c = 'In Progress' AND Pace_Status__c = 'On Track'];
        Integer totalProj = [SELECT COUNT() FROM Sprint__c WHERE Status__c = 'In Progress'];
        Integer onTimePct = totalProj > 0 ? (onTrack * 100) / totalProj : 0;

        Integer completed = [
            SELECT COUNT() FROM Case
            WHERE  Status IN ('Completed','Closed')
              AND  LastModifiedDate >= :DateTime.newInstance(w4Ago, Time.newInstance(0,0,0,0))
        ];

        // Neutral when no data exists; otherwise base status on utilization vs planned capacity
        String status = (totalMins == 0 && totalProj == 0) ? 'neutral'
            : utilPct >= 75 ? 'good'
            : utilPct >= 60 ? 'warning'
            : 'critical';

        CardData cd = new CardData();
        cd.title    = 'Team Performance';
        cd.subtitle = 'Last 4 Weeks';
        cd.question    = 'Did the team perform as expected?';
        cd.status      = status;
        cd.benchmarks  = bm('< 60% utilization', '60–75% utilization', '> 75% utilization');
        cd.kpis = new List<KPI>{
            kpi('Utilization',       utilPct + '%',              utilPct >= 75 ? 'up' : 'down', 'vs planned capacity'),
            kpi('Projects On Track', onTrack + '/' + totalProj, onTimePct >= 70 ? 'up' : 'down', 'on-time rate'),
            kpi('Stories Closed',    String.valueOf(completed),  'neutral',                       '4-week total')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hours', data, '#00b4d8') };
        cd.insights    = new List<String>{
            utilPct + '% team utilization over the last 4 weeks (' + hrs(totalMins) + ' logged)',
            onTrack + ' of ' + totalProj + ' active projects currently on track (' + onTimePct + '%)',
            completed + ' stories closed in the period'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPastCustomer() {
        Date w4Ago = Date.today().addDays(-28);

        // On-time rate from active projects
        Integer onTrack   = [SELECT COUNT() FROM Sprint__c WHERE Status__c = 'In Progress' AND Pace_Status__c = 'On Track'];
        Integer totalProj = [SELECT COUNT() FROM Sprint__c WHERE Status__c = 'In Progress'];
        Integer onTimePct = totalProj > 0 ? (onTrack * 100) / totalProj : 0;

        // Hours delivered vs committed pace (sum from active sprints)
        Decimal deliveredHrs = 0;
        Decimal committedHrs = 0;
        for (Sprint__c s : [
            SELECT Hours_Delivered__c, On_Time_Weekly_Pace__c
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
        ]) {
            if (s.Hours_Delivered__c != null)      deliveredHrs += s.Hours_Delivered__c;
            if (s.On_Time_Weekly_Pace__c != null)  committedHrs += s.On_Time_Weekly_Pace__c * 4;
        }
        Integer deliveryPct = committedHrs > 0
            ? Integer.valueOf(((deliveredHrs / committedHrs) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;

        // Scope changes in the past 4 weeks
        Integer scopeChanges = [
            SELECT COUNT() FROM Case
            WHERE  Type = 'Change Request'
              AND  CreatedDate >= :DateTime.newInstance(w4Ago, Time.newInstance(0,0,0,0))
        ];

        // Chart: hours by project
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
        Map<String, String> projNames = new Map<String, String>();
        for (Sprint__c s : [SELECT Id, Name FROM Sprint__c WHERE Id IN :projMins.keySet()]) {
            projNames.put(s.Id, s.Name);
        }
        List<String>  chartLabels = new List<String>();
        List<Decimal> chartData   = new List<Decimal>();
        for (String pid : projMins.keySet()) {
            String lbl = projNames.containsKey(pid) ? projNames.get(pid) : 'Unknown';
            chartLabels.add(lbl.length() > 18 ? lbl.substring(0, 18) + '…' : lbl);
            chartData.add((projMins.get(pid) / 60).setScale(1, RoundingMode.HALF_UP));
        }

        String status = totalProj == 0 ? 'neutral'
            : onTimePct >= 90 ? 'good'
            : onTimePct >= 70 ? 'warning'
            : 'critical';

        CardData cd = new CardData();
        cd.title    = 'Client Delivery';
        cd.subtitle = 'Last 4 Weeks';
        cd.question   = 'Did we deliver on our commitments?';
        cd.status     = status;
        cd.benchmarks = bm('< 70% on time', '70–90% on time', '> 90% on time');
        cd.kpis = new List<KPI>{
            kpi('On-Time Rate',    onTimePct + '%',             onTimePct >= 90 ? 'up' : 'down',   'active projects'),
            kpi('Hours Delivered', deliveredHrs.setScale(0, RoundingMode.HALF_UP) + 'h',
                                                                deliveryPct >= 90 ? 'up' : 'down', 'vs ' + committedHrs.setScale(0, RoundingMode.HALF_UP) + 'h pace'),
            kpi('Scope Changes',   String.valueOf(scopeChanges), scopeChanges == 0 ? 'up' : 'down', 'last 4 weeks')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = chartLabels;
        cd.datasets    = new List<ChartDataset>{ ds('Hours', chartData, '#0096c7') };
        cd.insights    = new List<String>{
            onTimePct + '% of active projects on track to deliver on time',
            deliveredHrs.setScale(0, RoundingMode.HALF_UP) + 'h delivered vs ' + committedHrs.setScale(0, RoundingMode.HALF_UP) + 'h committed pace (' + deliveryPct + '%)',
            scopeChanges + ' scope change' + (scopeChanges == 1 ? '' : 's') + ' raised in the past 4 weeks'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPastEmployee() {
        Date w4Ago = Date.today().addDays(-28);

        // Hours logged per person
        Map<String, Decimal> personMins = new Map<String, Decimal>();
        List<String>  labels = new List<String>();
        List<Decimal> data   = new List<Decimal>();
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
            personMins.put(nm, m);
            labels.add(nm);
            data.add((m / 60).setScale(1, RoundingMode.HALF_UP));
        }

        // Contractor targets: Available_Hours__c/week × 4 weeks × 60 min, match by name
        Map<String, Decimal> targets = new Map<String, Decimal>();
        for (Contact c : [
            SELECT Name, Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            targets.put(c.Name, c.Available_Hours__c * 4 * 60);
        }

        // Members who logged ≥80% of their 4-week allocation
        Integer metTarget = 0;
        Integer teamSize  = targets.size();
        for (String name : targets.keySet()) {
            Decimal logged = personMins.containsKey(name) ? personMins.get(name) : 0;
            if (logged >= targets.get(name) * 0.8) metTarget++;
        }
        Integer metPct = teamSize > 0 ? (metTarget * 100) / teamSize : 0;

        Integer completed = [
            SELECT COUNT() FROM Case
            WHERE  Status IN ('Completed','Closed')
              AND  LastModifiedDate >= :DateTime.newInstance(w4Ago, Time.newInstance(0,0,0,0))
        ];

        Decimal totalMins = 0;
        for (Decimal m : personMins.values()) totalMins += m;
        Decimal avgMins = personMins.size() > 0 ? totalMins / personMins.size() : 0;

        String status = teamSize == 0 ? 'neutral'
            : metPct >= 80 ? 'good'
            : metPct >= 50 ? 'warning'
            : 'critical';

        CardData cd = new CardData();
        cd.title    = 'Individual Performance';
        cd.subtitle = 'Last 4 Weeks';
        cd.question   = 'Did everyone meet their objectives?';
        cd.status     = status;
        cd.benchmarks = bm('< 50% met targets', '50–80% met targets', '> 80% met targets');
        cd.kpis = new List<KPI>{
            kpi('Met Hour Targets', metTarget + '/' + teamSize,   metPct >= 80 ? 'up' : 'down', '≥80% of allocation'),
            kpi('Stories Closed',   String.valueOf(completed),    'neutral',                     '4-week total'),
            kpi('Avg Hours/Person', hrs(avgMins),                 'neutral',                     'per active member')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hours', data, '#0077b6') };
        cd.insights    = new List<String>{
            metTarget + ' of ' + teamSize + ' contractors met their hour targets (' + metPct + '%)',
            completed + ' stories completed across the team in 4 weeks',
            'Average ' + hrs(avgMins) + ' per active member over the period'
        };
        return cd;
    }

    // ── Row 2: Present ────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static CardData getPresentManagement() {
        // Team capacity this week
        Decimal contractorWeeklyHrs = 0;
        for (Contact c : [
            SELECT Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            contractorWeeklyHrs += c.Available_Hours__c;
        }

        // Weekly demand from active projects (sum of on-pace hourly requirement)
        Decimal weeklyDemand   = 0;
        Integer activeProjects = 0;
        for (Sprint__c s : [
            SELECT On_Time_Weekly_Pace__c
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
        ]) {
            activeProjects++;
            if (s.On_Time_Weekly_Pace__c != null) weeklyDemand += s.On_Time_Weekly_Pace__c;
        }

        // Story readiness — "workable" statuses vs total active
        Map<String, Integer> sCounts = new Map<String, Integer>();
        for (AggregateResult ar : [
            SELECT Status s, COUNT(Id) c
            FROM   Case
            WHERE  Status NOT IN ('Completed','Closed','Cancelled')
            GROUP BY Status
        ]) {
            sCounts.put((String) ar.get('s'), (Integer) ar.get('c'));
        }
        Integer totalActive  = 0;
        Integer readyStories = 0;
        Integer blocked      = 0;
        Set<String> readyStatuses = new Set<String>{
            'New', 'Scheduled', 'Work In Progress (WIP)', 'In Review', 'In UAT'
        };
        for (String st : sCounts.keySet()) {
            Integer cnt = sCounts.get(st);
            totalActive += cnt;
            if (readyStatuses.contains(st)) readyStories += cnt;
            if (st == 'Blocked') blocked = cnt;
        }
        Integer readyPct = totalActive > 0 ? (readyStories * 100) / totalActive : 0;

        // Status: demand vs capacity — demand > capacity by 10%+ = critical
        Decimal demandRatio = contractorWeeklyHrs > 0 ? weeklyDemand / contractorWeeklyHrs : 0;
        String  status      = activeProjects == 0 ? 'neutral'
            : demandRatio > 1.1 ? 'critical'
            : demandRatio > 1.0 ? 'warning'
            : 'good';

        // Chart: grouped Capacity vs Demand bars
        Decimal capH = contractorWeeklyHrs.setScale(1, RoundingMode.HALF_UP);
        Decimal demH = weeklyDemand.setScale(1, RoundingMode.HALF_UP);
        String demandColor = demandRatio > 1.0 ? '#ef4444' : '#00b4d8';

        CardData cd = new CardData();
        cd.title    = 'Delivery Readiness';
        cd.subtitle = 'This Week';
        cd.question   = 'Is delivery set up to execute this week?';
        cd.status     = status;
        cd.benchmarks = bm('Demand > capacity', 'Demand ≈ capacity', 'Capacity covers demand');
        cd.kpis = new List<KPI>{
            kpi('Capacity / Demand', capH.setScale(0, RoundingMode.HALF_UP) + 'h / ' + demH.setScale(0, RoundingMode.HALF_UP) + 'h',
                                                 demandRatio <= 1.0 ? 'up' : 'down', 'this week'),
            kpi('Work Ready',  readyPct + '%',   readyPct >= 80 ? 'up' : 'down',  readyStories + ' of ' + totalActive + ' stories'),
            kpi('Blocked',     String.valueOf(blocked), blocked > 0 ? 'down' : 'neutral', 'need attention')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = new List<String>{ 'This Week' };
        cd.datasets    = new List<ChartDataset>{
            ds('Capacity', new List<Decimal>{ capH }, '#22c55e'),
            ds('Demand',   new List<Decimal>{ demH }, demandColor)
        };
        cd.insights    = new List<String>{
            capH.setScale(0, RoundingMode.HALF_UP) + 'h team capacity vs ' + demH.setScale(0, RoundingMode.HALF_UP) + 'h committed demand across ' + activeProjects + ' active projects',
            readyPct + '% of active stories are in a workable state (' + readyStories + ' of ' + totalActive + ')',
            blocked > 0 ? blocked + ' blocked stories need immediate unblocking' : 'No blocked stories — team can execute'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPresentCustomer() {
        // Contractor capacity
        Decimal contractorWeeklyHrs = 0;
        for (Contact c : [
            SELECT Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            contractorWeeklyHrs += c.Available_Hours__c;
        }

        // Active client engagements
        List<Sprint__c> projects = [
            SELECT Id, Name, On_Time_Weekly_Pace__c, Pace_Status__c, Accountlu__r.Name
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
            ORDER BY On_Time_Weekly_Pace__c DESC NULLS LAST
            LIMIT  15
        ];

        Decimal weeklyCommitted = 0;
        Integer underserved     = 0;
        List<String>  chartLabels = new List<String>();
        List<Decimal> chartData   = new List<Decimal>();

        for (Sprint__c s : projects) {
            Decimal pace = s.On_Time_Weekly_Pace__c != null ? s.On_Time_Weekly_Pace__c : 0;
            weeklyCommitted += pace;
            String ps = s.Pace_Status__c != null ? s.Pace_Status__c : '';
            if (ps == 'Behind' || ps == 'Critical') underserved++;
            String lbl = s.Accountlu__r?.Name != null ? s.Accountlu__r.Name : s.Name;
            chartLabels.add(lbl.length() > 16 ? lbl.substring(0, 16) + '…' : lbl);
            chartData.add(pace.setScale(1, RoundingMode.HALF_UP));
        }

        Integer activeEngagements = projects.size();
        Integer coveragePct = contractorWeeklyHrs > 0
            ? Integer.valueOf(((weeklyCommitted / contractorWeeklyHrs) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;

        // Status: underserved clients = critical; book-of-business gaps = warning/critical
        String status = activeEngagements == 0 ? 'neutral'
            : underserved > 0   ? 'critical'
            : coveragePct >= 80 ? 'good'
            : coveragePct >= 60 ? 'warning'
            : 'critical';

        CardData cd = new CardData();
        cd.title    = 'Client Coverage';
        cd.subtitle = 'This Week';
        cd.question   = 'Are we fully committed and fully covered?';
        cd.status     = status;
        cd.benchmarks = bm('< 60% capacity booked', '60–80% capacity booked', '> 80% capacity booked');
        cd.kpis = new List<KPI>{
            kpi('Active Engagements', String.valueOf(activeEngagements), 'neutral', 'client projects'),
            kpi('Book of Business',   coveragePct + '%',                 coveragePct >= 80 ? 'up' : 'down', 'of capacity committed'),
            kpi('Underserved',        String.valueOf(underserved),       underserved > 0 ? 'down' : 'neutral', 'projects behind pace')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = chartLabels;
        cd.datasets    = new List<ChartDataset>{ ds('Hrs/Week', chartData, '#0096c7') };
        cd.insights    = new List<String>{
            activeEngagements + ' active client engagement' + (activeEngagements == 1 ? '' : 's') + ' this week',
            weeklyCommitted.setScale(0, RoundingMode.HALF_UP) + 'h committed vs ' + contractorWeeklyHrs.setScale(0, RoundingMode.HALF_UP) + 'h available (' + coveragePct + '% booked)',
            underserved > 0
                ? underserved + ' project' + (underserved == 1 ? '' : 's') + ' behind pace — client commitments at risk'
                : 'All active projects on track to meet client commitments'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPresentEmployee() {
        Date weekStart = Date.today().toStartOfWeek();

        // Days elapsed in the current work week (1 = Mon, 5 = Fri, capped at 5)
        Integer daysElapsed = weekStart.daysBetween(Date.today()) + 1;
        if (daysElapsed > 5) daysElapsed = 5;
        if (daysElapsed < 1) daysElapsed = 1;

        // Hours logged this week per person (keyed by creator name)
        Map<String, Decimal> loggedMins = new Map<String, Decimal>();
        for (AggregateResult ar : [
            SELECT CreatedBy.Name nm, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  Logged_Date__c >= :weekStart
            GROUP BY CreatedBy.Name
        ]) {
            String  nm = (String)  ar.get('nm');
            Decimal m  = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            loggedMins.put(nm, m);
        }

        // Per-contractor readiness: compare logged to pro-rated weekly target
        Integer overloaded    = 0;
        Integer underutilized = 0;
        Integer withWork      = 0;
        Integer teamSize      = 0;
        List<String>  chartLabels = new List<String>();
        List<Decimal> loggedData  = new List<Decimal>();
        List<Decimal> targetData  = new List<Decimal>();

        for (Contact c : [
            SELECT Name, Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
            ORDER BY Name
        ]) {
            teamSize++;
            Decimal dailyCapMins  = (c.Available_Hours__c / 5) * 60;
            Decimal proRatedMins  = dailyCapMins * daysElapsed;
            Decimal weeklyCapMins = c.Available_Hours__c * 60;
            Decimal logged        = loggedMins.containsKey(c.Name) ? loggedMins.get(c.Name) : 0;

            if (logged > 0)                   withWork++;
            if (logged > weeklyCapMins * 1.1) overloaded++;
            if (logged < proRatedMins  * 0.5) underutilized++;

            String nm = c.Name.length() > 16 ? c.Name.substring(0, 16) + '…' : c.Name;
            chartLabels.add(nm);
            loggedData.add((logged       / 60).setScale(1, RoundingMode.HALF_UP));
            targetData.add((proRatedMins / 60).setScale(1, RoundingMode.HALF_UP));
        }

        // Status: any overloaded = critical; any underutilized = warning; else good
        String status = teamSize == 0 ? 'neutral'
            : overloaded    > 0 ? 'critical'
            : underutilized > 0 ? 'warning'
            : 'good';

        CardData cd = new CardData();
        cd.title    = 'Individual Readiness';
        cd.subtitle = 'This Week';
        cd.question   = 'Does everyone have clear work and the capacity to do it?';
        cd.status     = status;
        cd.benchmarks = bm('Anyone overloaded/idle', 'Some underutilized', 'Everyone balanced');
        cd.kpis = new List<KPI>{
            kpi('With Work',     withWork + '/' + teamSize,    withWork == teamSize ? 'up' : 'down', 'logged time this week'),
            kpi('Overloaded',    String.valueOf(overloaded),   overloaded    > 0 ? 'down' : 'neutral', '>110% of capacity'),
            kpi('Underutilized', String.valueOf(underutilized), underutilized > 0 ? 'down' : 'neutral', '<50% of pro-rated hrs')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = chartLabels;
        cd.datasets    = new List<ChartDataset>{
            ds('Logged',           loggedData, '#48cae4'),
            ds('Target (pro-rated)', targetData, '#334155')
        };
        cd.insights    = new List<String>{
            withWork + ' of ' + teamSize + ' contractors have logged time this week',
            overloaded    > 0 ? overloaded    + ' contractor' + (overloaded    == 1 ? '' : 's') + ' tracking over capacity this week'    : 'No contractors overloaded this week',
            underutilized > 0 ? underutilized + ' contractor' + (underutilized == 1 ? '' : 's') + ' below 50% of pro-rated hours' : 'All contractors on pace this week'
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
