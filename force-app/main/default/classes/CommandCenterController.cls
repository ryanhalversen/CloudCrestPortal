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
        @AuraEnabled public String  chartDatasetType; // 'line' for mixed charts (per-dataset type override)
        @AuraEnabled public Boolean isRef;            // true = reference/target line styling
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
        @AuraEnabled public List<String>       chartProjectIds; // optional: Sprint__c IDs parallel to chartLabels for bar click drilldown
        @AuraEnabled public List<ChartDataset> datasets;
        @AuraEnabled public List<String>       insights;
        @AuraEnabled public List<KPI>          modalKpis;    // optional extended KPIs for popup (replaces kpis in modal)
        @AuraEnabled public String             chartType2;   // second chart type
        @AuraEnabled public List<String>       chartLabels2; // second chart x-axis labels
        @AuraEnabled public List<ChartDataset> datasets2;    // second chart datasets
        @AuraEnabled public List<ProjectRow>   projects; // optional: used for popup project list
    }

    public class DrilldownData {
        @AuraEnabled public String        projectName;
        @AuraEnabled public List<String>  labels;
        @AuraEnabled public List<Decimal> delivered;
        @AuraEnabled public List<Decimal> committed;     // null for Block projects
        @AuraEnabled public Decimal       totalDelivered; // sum of all 8 weeks (hours)
        @AuraEnabled public Integer       deliveryRate;   // % vs committed; null for Block
        @AuraEnabled public String        paceStatus;     // raw Pace_Status__c value
    }

    public class ProjectRow {
        @AuraEnabled public String name;
        @AuraEnabled public String paceStatus;
        @AuraEnabled public String id;
    }

    // ── FTE Capacity Constants ────────────────────────────────────────────────
    // 3 FTEs × 35h + Delivery Manager (Alec Hampton) × 20h = 125h/wk
    // Update these if team composition changes
    private static final Decimal FTE_WEEKLY_TARGET_HRS = 125;
    private static final Decimal FTE_4WK_TARGET_HRS    = 500;  // FTE_WEEKLY_TARGET_HRS × 4

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

        // Contractor names — excluded from FTE hour calculation
        Set<String> contractorNames = new Set<String>();
        for (Contact c : [
            SELECT Name FROM Contact WHERE Account.Name = 'CloudCrest Contractors'
        ]) {
            contractorNames.add(c.Name);
        }
        // Prevent empty-set SOQL edge case — dummy value has no match
        if (contractorNames.isEmpty()) contractorNames.add('__NO_MATCH__');

        // FTE time entries (all users except contractors) bucketed by week
        Map<Date, Decimal> byWeek = new Map<Date, Decimal>();
        Decimal totalFteMins = 0;
        for (AggregateResult ar : [
            SELECT Logged_Date__c dt, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  Logged_Date__c   >= :w4Ago
              AND  CreatedBy.Name NOT IN :contractorNames
            GROUP BY Logged_Date__c
        ]) {
            Date    day = (Date)    ar.get('dt');
            Decimal m   = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            Date wk = day.toStartOfWeek();
            byWeek.put(wk, (byWeek.containsKey(wk) ? byWeek.get(wk) : 0) + m);
            totalFteMins += m;
        }

        // Build 4-week chart: weekly FTE hours + 125h/wk target reference line
        List<String>  labels     = new List<String>();
        List<Decimal> loggedData = new List<Decimal>();
        List<Decimal> targetData = new List<Decimal>();
        Decimal maxWkHrs  = -1;
        Decimal minWkHrs  = -1;
        String  maxWkLabel = '';
        String  minWkLabel = '';

        for (Integer i = 3; i >= 0; i--) {
            Date    wk  = ws.addDays(-i * 7);
            String  lbl = weekLabel(wk);
            Decimal h   = ((byWeek.containsKey(wk) ? byWeek.get(wk) : 0) / 60).setScale(1, RoundingMode.HALF_UP);
            labels.add(lbl);
            loggedData.add(h);
            targetData.add(FTE_WEEKLY_TARGET_HRS);
            if (h > maxWkHrs || maxWkHrs < 0) { maxWkHrs = h; maxWkLabel = lbl; }
            if (h < minWkHrs || minWkHrs < 0) { minWkHrs = h; minWkLabel = lbl; }
        }

        Decimal totalFteHrs = (totalFteMins / 60).setScale(1, RoundingMode.HALF_UP);
        Integer utilPct     = Integer.valueOf(((totalFteHrs / FTE_4WK_TARGET_HRS) * 100).setScale(0, RoundingMode.HALF_UP));

        // Active projects — count on-track vs slipped using actual Pace_Status__c formula values:
        //   "🚀 Ahead of Pace 🚀", "✅ On Pace ✅", "⚠️ Behind Pace ⚠️", "🚨 Houston, We Have A Problem 🚨"
        // TODO: milestones missed — no dedicated milestone/deadline object in schema;
        //       would require a Milestone__c object or Case Type='Milestone' to track properly
        List<Sprint__c> activeProjects = [
            SELECT Name, Pace_Status__c, Accountlu__r.Name
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
            ORDER BY Name ASC
            LIMIT  50
        ];
        Integer onTrack   = 0;
        Integer slipped   = 0;
        Integer totalProj = activeProjects.size();
        List<ProjectRow> projectRows = new List<ProjectRow>();
        for (Sprint__c s : activeProjects) {
            String ps = s.Pace_Status__c != null ? s.Pace_Status__c : '';
            if      (ps.contains('Ahead') || ps.contains('On Pace')) onTrack++;
            else if (ps.contains('Behind') || ps.contains('Problem') || ps.contains('Houston')) slipped++;
            ProjectRow pr = new ProjectRow();
            pr.id         = s.Id;
            pr.name       = s.Accountlu__r?.Name != null ? s.Accountlu__r.Name : s.Name;
            pr.paceStatus = ps.length() > 0 ? ps : '—';
            projectRows.add(pr);
        }

        // Neutral only when there is truly no data; otherwise threshold on utilization
        String status = (totalFteMins == 0 && totalProj == 0) ? 'neutral'
            : utilPct >= 75 ? 'good'
            : utilPct >= 60 ? 'warning'
            : 'critical';

        // Chart: actual weekly FTE hours (line) + 125h/wk target (dashed line)
        ChartDataset logDs = ds('Hours Logged',      loggedData, '#00b4d8');
        ChartDataset tgtDs = ds('Target (125h/wk)',  targetData, '#334155');
        tgtDs.isDashed = true;

        // Dynamic insights: gap, slippage, outlier week
        List<String> insights = new List<String>();
        Decimal gapHrs = (FTE_4WK_TARGET_HRS - totalFteHrs).setScale(0, RoundingMode.HALF_UP);
        if (utilPct >= 75) {
            insights.add(utilPct + '% utilization — ' + totalFteHrs.setScale(0, RoundingMode.HALF_UP) + 'h of ' + FTE_4WK_TARGET_HRS.setScale(0, RoundingMode.HALF_UP) + 'h target logged over 4 weeks');
        } else {
            insights.add(utilPct + '% utilization — ' + gapHrs + 'h below the ' + FTE_4WK_TARGET_HRS.setScale(0, RoundingMode.HALF_UP) + 'h target (' + totalFteHrs.setScale(0, RoundingMode.HALF_UP) + 'h logged)');
        }
        if (slipped > 0) {
            insights.add(slipped + ' project' + (slipped == 1 ? '' : 's') + ' slipped off track this period — review pacing and commitments');
        } else if (totalProj > 0) {
            insights.add('All ' + totalProj + ' active project' + (totalProj == 1 ? '' : 's') + ' on track');
        }
        // Outlier week callout (only if 4 weeks of data are available)
        if (loggedData.size() == 4 && minWkHrs >= 0) {
            if (maxWkHrs >= FTE_WEEKLY_TARGET_HRS * 1.1) {
                insights.add('Strong week: ' + maxWkLabel + ' logged ' + maxWkHrs + 'h (above 125h target)');
            } else if (minWkHrs < FTE_WEEKLY_TARGET_HRS * 0.6) {
                insights.add('Low-output week: ' + minWkLabel + ' logged only ' + minWkHrs + 'h — investigate cause');
            }
        }

        CardData cd = new CardData();
        cd.title     = 'Team Performance';
        cd.subtitle  = 'Last 4 Weeks';
        cd.question  = 'Did the team perform as expected?';
        cd.status    = status;
        cd.benchmarks = bm('< 60% utilization', '60–75% utilization', '> 75% utilization');
        cd.kpis = new List<KPI>{
            kpi('Projects On Track', onTrack + ' / ' + totalProj,
                                     onTrack == totalProj ? 'up' : slipped > 0 ? 'down' : 'neutral',
                                     'active projects'),
            kpi('Hours vs Target',   totalFteHrs.setScale(0, RoundingMode.HALF_UP) + 'h / ' + FTE_4WK_TARGET_HRS.setScale(0, RoundingMode.HALF_UP) + 'h',
                                     totalFteHrs >= FTE_4WK_TARGET_HRS * 0.75 ? 'up' : 'down',
                                     '4-week FTE total'),
            kpi('Utilization',       utilPct + '%',
                                     utilPct >= 75 ? 'up' : 'down',
                                     'vs 500h target')
        };
        cd.chartType   = 'line';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ logDs, tgtDs };
        cd.insights    = insights;
        cd.projects    = projectRows;
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPastCustomer() {
        Date w4Ago = Date.today().addDays(-28);
        Date ws    = Date.today().toStartOfWeek();

        // ── 1. All active projects, sorted by weekly commitment desc ──────────
        List<Sprint__c> rawProjects = [
            SELECT Id, Name, Contract_Type__c, Weekly_Pace_Estimate__c, Accountlu__r.Name
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
            ORDER BY Weekly_Pace_Estimate__c DESC NULLS LAST, Name ASC
            LIMIT  25
        ];
        // Exclude internal CloudCrest projects from client delivery reporting
        List<Sprint__c> allProjects = new List<Sprint__c>();
        for (Sprint__c s : rawProjects) {
            String acctName = s.Accountlu__r?.Name != null ? s.Accountlu__r.Name : '';
            if (!s.Name.containsIgnoreCase('CloudCrest') && !acctName.containsIgnoreCase('CloudCrest')) {
                allProjects.add(s);
            }
        }

        // ── 2. Partition by contract type ──────────────────────────────────────
        Set<Id>          retainerIds  = new Set<Id>();          // non-Block with weekly hrs set
        Set<Id>          blockIds     = new Set<Id>();           // Block: results-based, no weekly pace
        Map<Id, Decimal> weeklyCommit = new Map<Id, Decimal>(); // retainer → h/wk committed
        Map<Id, String>  displayName  = new Map<Id, String>();
        List<String>     missingData  = new List<String>();     // non-Block but no weekly hrs

        for (Sprint__c s : allProjects) {
            String nm = s.Accountlu__r?.Name != null ? s.Accountlu__r.Name : s.Name;
            displayName.put(s.Id, nm);
            if (s.Contract_Type__c == 'Block') {
                blockIds.add(s.Id);
            } else if (s.Weekly_Pace_Estimate__c != null && s.Weekly_Pace_Estimate__c > 0) {
                retainerIds.add(s.Id);
                weeklyCommit.put(s.Id, s.Weekly_Pace_Estimate__c);
            } else {
                missingData.add(nm);
            }
        }

        // ── 3. Hours delivered per project (last 4 weeks) ─────────────────────
        Set<Id> trackedIds = new Set<Id>(retainerIds);
        trackedIds.addAll(blockIds);

        Map<Id, Decimal> deliveredMins = new Map<Id, Decimal>();
        if (!trackedIds.isEmpty()) {
            for (AggregateResult ar : [
                SELECT Case__r.Projects__c pid, SUM(Minutes_Logged__c) m
                FROM   Time__c
                WHERE  Logged_Date__c       >= :w4Ago
                  AND  Case__r.Projects__c  IN :trackedIds
                GROUP BY Case__r.Projects__c
            ]) {
                String  pid = (String) ar.get('pid');
                Decimal m   = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
                if (pid != null) deliveredMins.put((Id) pid, m);
            }
        }

        // ── 4. Commitment vs delivery roll-up (retainer projects only) ────────
        Decimal totalCommittedHrs = 0;
        Decimal totalDeliveredHrs = 0;
        Integer atPace            = 0;
        List<String> underProjs   = new List<String>(); // < 70% of commitment
        List<String> overProjs    = new List<String>();  // > 120% of commitment

        for (Id pid : retainerIds) {
            Decimal committed4Wk = weeklyCommit.get(pid) * 4;
            Decimal delivered    = deliveredMins.containsKey(pid) ? deliveredMins.get(pid) / 60 : 0;
            totalCommittedHrs   += committed4Wk;
            totalDeliveredHrs   += delivered;
            if ((delivered / 4) >= weeklyCommit.get(pid)) atPace++;
            if (committed4Wk > 0) {
                Integer pct = Integer.valueOf(((delivered / committed4Wk) * 100).setScale(0, RoundingMode.HALF_UP));
                if (pct < 70)  underProjs.add(displayName.get(pid) + ' (' + pct + '%)');
                if (pct > 120) overProjs.add(displayName.get(pid)  + ' (' + pct + '%)');
            }
        }

        Integer deliveryRate = totalCommittedHrs > 0
            ? Integer.valueOf(((totalDeliveredHrs / totalCommittedHrs) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;

        // ── 5. Weekly trend (retainer projects, last 4 weeks) ─────────────────
        Map<Date, Decimal> wkMins = new Map<Date, Decimal>();
        if (!retainerIds.isEmpty()) {
            for (AggregateResult ar : [
                SELECT Logged_Date__c dt, SUM(Minutes_Logged__c) m
                FROM   Time__c
                WHERE  Logged_Date__c      >= :w4Ago
                  AND  Case__r.Projects__c IN :retainerIds
                GROUP BY Logged_Date__c
            ]) {
                Date    day = (Date)    ar.get('dt');
                Decimal m   = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
                Date wk = day.toStartOfWeek();
                wkMins.put(wk, (wkMins.containsKey(wk) ? wkMins.get(wk) : 0) + m);
            }
        }
        List<Decimal> weeklyHrs = new List<Decimal>();
        for (Integer i = 3; i >= 0; i--) {
            Date    wk = ws.addDays(-i * 7);
            Decimal h  = wkMins.containsKey(wk) ? (wkMins.get(wk) / 60).setScale(1, RoundingMode.HALF_UP) : 0;
            weeklyHrs.add(h);
        }
        Boolean improving = weeklyHrs.size() == 4 && weeklyHrs[0] > 0 && weeklyHrs[3] > weeklyHrs[0];
        Boolean declining = weeklyHrs.size() == 4 && weeklyHrs[0] > 0 && weeklyHrs[3] < weeklyHrs[0] * 0.8;

        // ── 6. Status ──────────────────────────────────────────────────────────
        String status = retainerIds.isEmpty() ? 'neutral'
            : deliveryRate >= 95 ? 'good'
            : deliveryRate >= 80 ? 'warning'
            : 'critical';

        // ── 7. Chart: grouped bar — Delivered vs Committed per project ─────────
        // Retainer projects (ordered by weekly pace desc) then Block projects
        List<String>  chartLabels      = new List<String>();
        List<String>  chartProjectIds  = new List<String>();
        List<Decimal> deliveredData    = new List<Decimal>();
        List<Decimal> committedData    = new List<Decimal>(); // 0 for Block projects

        for (Sprint__c s : allProjects) {
            Boolean isRetainer = retainerIds.contains(s.Id);
            Boolean isBlock    = blockIds.contains(s.Id);
            if (!isRetainer && !isBlock) continue;
            String lbl = displayName.get(s.Id);
            // Mark Block projects with a dot in the label
            chartLabels.add((lbl.length() > 15 ? lbl.substring(0, 15) + '…' : lbl) + (isBlock ? ' ●' : ''));
            chartProjectIds.add(s.Id);
            Decimal delivered = deliveredMins.containsKey(s.Id)
                ? (deliveredMins.get(s.Id) / 60).setScale(1, RoundingMode.HALF_UP) : 0;
            deliveredData.add(delivered);
            committedData.add(isRetainer ? (weeklyCommit.get(s.Id) * 4).setScale(1, RoundingMode.HALF_UP) : 0);
        }

        // ── 8. Insights ────────────────────────────────────────────────────────
        List<String> insights = new List<String>();
        Decimal gapHrs = (totalCommittedHrs - totalDeliveredHrs).setScale(0, RoundingMode.HALF_UP);
        if (deliveryRate >= 95) {
            insights.add(deliveryRate + '% delivery rate — ' + totalDeliveredHrs.setScale(0, RoundingMode.HALF_UP) + 'h of ' + totalCommittedHrs.setScale(0, RoundingMode.HALF_UP) + 'h committed — all commitments met');
        } else {
            insights.add(deliveryRate + '% delivery rate — ' + gapHrs + 'h below commitment (' + totalDeliveredHrs.setScale(0, RoundingMode.HALF_UP) + 'h of ' + totalCommittedHrs.setScale(0, RoundingMode.HALF_UP) + 'h)');
        }
        if (!underProjs.isEmpty()) {
            List<String> top = new List<String>();
            for (Integer i = 0; i < underProjs.size() && i < 3; i++) top.add(underProjs[i]);
            insights.add('Significantly underdelivered (< 70%): ' + String.join(top, ', '));
        }
        if (!overProjs.isEmpty()) {
            List<String> top = new List<String>();
            for (Integer i = 0; i < overProjs.size() && i < 2; i++) top.add(overProjs[i]);
            insights.add('Potential scope creep (> 120%): ' + String.join(top, ', ') + ' — review with client');
        }
        if (improving) {
            insights.add('Delivery trending up week over week — positive momentum');
        } else if (declining) {
            insights.add('Delivery declined over the period — review staffing and priorities');
        }
        if (!missingData.isEmpty()) {
            Integer n = missingData.size();
            insights.add(n + ' active project' + (n == 1 ? '' : 's') + ' missing Weekly Retained Hours — update project records to include in tracking');
        }

        CardData cd = new CardData();
        cd.title      = 'Client Delivery';
        cd.subtitle   = 'Last 4 Weeks';
        cd.question   = 'Did we deliver on our commitments?';
        cd.status     = status;
        cd.benchmarks = bm('< 80% delivery rate', '80–95% delivery rate', '> 95% delivery rate');
        cd.kpis = new List<KPI>{
            kpi('Hours Delivered',
                totalDeliveredHrs.setScale(0, RoundingMode.HALF_UP) + 'h / ' + totalCommittedHrs.setScale(0, RoundingMode.HALF_UP) + 'h',
                deliveryRate >= 95 ? 'up' : 'down', 'vs committed (4 wk)'),
            kpi('Delivery Rate',
                deliveryRate + '%',
                deliveryRate >= 95 ? 'up' : deliveryRate >= 80 ? 'neutral' : 'down',
                'hours delivered vs committed'),
            kpi('Projects at Pace',
                atPace + ' / ' + retainerIds.size(),
                atPace == retainerIds.size() ? 'up' : 'down',
                'avg wkly hrs ≥ commitment')
        };
        cd.chartType       = 'bar';
        cd.chartLabels     = chartLabels;
        cd.chartProjectIds = chartProjectIds;
        cd.datasets        = new List<ChartDataset>{
            ds('Delivered (4wk)', deliveredData, '#00b4d8'),
            ds('Committed (4wk)', committedData, '#ef4444')
        };
        cd.insights = insights;
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getPastEmployee() {
        Date ws    = Date.today().toStartOfWeek();
        Date w4Ago = ws.addDays(-28);

        // ── Team configuration: name → weekly target (hours) ──────────────────
        // FTE = 35h/wk (140h/4wk), Head of Delivery = 20h/wk (80h/4wk)
        List<String>         teamOrder  = new List<String>{ 'Chris Manring', 'Holly Worz', 'Terri Lee', 'Alec Hampton' };
        Map<String, Decimal> weeklyTgt  = new Map<String, Decimal>{
            'Chris Manring' => 35, 'Holly Worz' => 35, 'Terri Lee' => 35, 'Alec Hampton' => 20
        };
        Set<String> teamSet = weeklyTgt.keySet();

        // ── 1. Build week-start list ──────────────────────────────────────────
        List<Date> weekStarts = new List<Date>();
        for (Integer i = 3; i >= 0; i--) weekStarts.add(ws.addDays(-i * 7));

        // ── 2. Query per-day totals and bucket into weeks ─────────────────────
        Map<String, Map<Date, Decimal>> personWeekMins = new Map<String, Map<Date, Decimal>>();
        for (String nm : teamOrder) {
            Map<Date, Decimal> wkMap = new Map<Date, Decimal>();
            for (Date wk : weekStarts) wkMap.put(wk, 0);
            personWeekMins.put(nm, wkMap);
        }
        for (AggregateResult ar : [
            SELECT CreatedBy.Name nm, Logged_Date__c dt, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  CreatedBy.Name IN :teamSet
              AND  Logged_Date__c >= :w4Ago
            GROUP BY CreatedBy.Name, Logged_Date__c
        ]) {
            String  nm = (String)  ar.get('nm');
            Date    dt = (Date)    ar.get('dt');
            Decimal m  = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            if (!personWeekMins.containsKey(nm)) continue;
            Date wk = dt.toStartOfWeek();
            Map<Date, Decimal> wkMap = personWeekMins.get(nm);
            wkMap.put(wk, (wkMap.containsKey(wk) ? wkMap.get(wk) : 0) + m);
        }

        // ── 3. Per-person 4-week totals ───────────────────────────────────────
        Map<String, Decimal> personTotalMins = new Map<String, Decimal>();
        for (String nm : teamOrder) {
            Decimal total = 0;
            for (Decimal m : personWeekMins.get(nm).values()) total += m;
            personTotalMins.put(nm, total);
        }

        // ── 4. KPI calculations ───────────────────────────────────────────────
        Integer metTarget       = 0;
        Decimal totalLoggedMins = 0;
        Decimal sumUtilPct      = 0;
        Decimal highPct = -1, lowPct = 999;
        String  highName = '', lowName = '';
        Map<String, Integer> personUtil = new Map<String, Integer>();

        for (String nm : teamOrder) {
            Decimal targetMins = weeklyTgt.get(nm) * 4 * 60;
            Decimal loggedMins = personTotalMins.get(nm);
            totalLoggedMins += loggedMins;
            Decimal utilDecimal = targetMins > 0 ? (loggedMins / targetMins) * 100 : 0;
            Integer utilInt     = Integer.valueOf(utilDecimal.setScale(0, RoundingMode.HALF_UP));
            personUtil.put(nm, utilInt);
            sumUtilPct += utilDecimal;
            if (loggedMins >= targetMins) metTarget++;
            if (utilDecimal > highPct) { highPct = utilDecimal; highName = nm; }
            if (utilDecimal < lowPct)  { lowPct  = utilDecimal; lowName  = nm; }
        }

        Integer avgUtil     = Integer.valueOf((sumUtilPct / 4).setScale(0, RoundingMode.HALF_UP));
        Decimal totalLogHrs = (totalLoggedMins / 60).setScale(0, RoundingMode.HALF_UP);
        Decimal totalTgtHrs = 500; // (3×35 + 20) × 4
        Integer highInt     = Integer.valueOf(highPct.setScale(0, RoundingMode.HALF_UP));
        Integer lowInt      = Integer.valueOf(lowPct.setScale(0, RoundingMode.HALF_UP));
        Integer spread      = highInt - lowInt;

        String status = metTarget >= 4 ? 'good'
                      : metTarget >= 2 ? 'warning'
                      : 'critical';

        // ── 5. Card KPIs (3) ──────────────────────────────────────────────────
        List<KPI> cardKpis = new List<KPI>{
            kpi('Met Hour Targets',       metTarget + ' / 4',
                                          metTarget == 4 ? 'up' : metTarget >= 2 ? 'neutral' : 'down',
                                          '4-week period'),
            kpi('Hours Logged vs Target', totalLogHrs.setScale(0, RoundingMode.HALF_UP) + 'h / ' + totalTgtHrs.setScale(0, RoundingMode.HALF_UP) + 'h',
                                          totalLoggedMins >= totalTgtHrs * 60 ? 'up' : 'down',
                                          'team total'),
            kpi('Avg Utilization',        avgUtil + '%',
                                          avgUtil >= 90 ? 'up' : avgUtil >= 75 ? 'neutral' : 'down',
                                          'avg of individuals')
        };

        // ── 6. Modal KPIs (6: 3 summary + high/low/spread) ───────────────────
        List<KPI> modalKpiList = new List<KPI>(cardKpis);
        modalKpiList.add(kpi('Highest Util',     highName + ' ' + highInt + '%', 'up',                    'top individual'));
        modalKpiList.add(kpi('Lowest Util',      lowName  + ' ' + lowInt  + '%', lowInt < 75 ? 'down' : 'neutral', 'bottom individual'));
        modalKpiList.add(kpi('Util Spread',      spread + '%',                    spread > 30 ? 'down' : 'neutral', 'high vs low'));

        // ── 7. Chart 1: Individual 4-week totals (bar + reference lines) ──────
        // Sort by hours logged DESC (simple bubble sort)
        List<String> sortedNames = new List<String>(teamOrder);
        for (Integer i = 0; i < sortedNames.size() - 1; i++) {
            for (Integer j = 0; j < sortedNames.size() - 1 - i; j++) {
                if (personTotalMins.get(sortedNames[j]) < personTotalMins.get(sortedNames[j + 1])) {
                    String tmp       = sortedNames[j];
                    sortedNames[j]   = sortedNames[j + 1];
                    sortedNames[j+1] = tmp;
                }
            }
        }

        List<String>  ch1Labels = new List<String>();
        List<Decimal> ch1Bars   = new List<Decimal>();
        List<Decimal> fteRef    = new List<Decimal>();  // 140h at FTE positions, null at Alec
        List<Decimal> alecRef   = new List<Decimal>();  // 80h at Alec position, null at FTEs

        for (String nm : sortedNames) {
            ch1Labels.add(nm == 'Alec Hampton' ? 'Alec (Head of Delivery)' : nm);
            ch1Bars.add((personTotalMins.get(nm) / 60).setScale(1, RoundingMode.HALF_UP));
            if (nm == 'Alec Hampton') {
                fteRef.add(null);
                alecRef.add(80);
            } else {
                fteRef.add(140);
                alecRef.add(null);
            }
        }

        ChartDataset barDs = ds('Hours Logged', ch1Bars, '#00b4d8');

        ChartDataset fteDs = new ChartDataset();
        fteDs.label           = 'FTE Target (140h)';
        fteDs.data            = fteRef;
        fteDs.color           = '#ef4444';
        fteDs.borderColor     = '#ef4444';
        fteDs.chartDatasetType = 'line';
        fteDs.isRef           = true;

        ChartDataset alecDs = new ChartDataset();
        alecDs.label           = 'HoD Target (80h)';
        alecDs.data            = alecRef;
        alecDs.color           = '#ef4444';
        alecDs.borderColor     = '#ef4444';
        alecDs.chartDatasetType = 'line';
        alecDs.isRef           = true;
        alecDs.isDashed        = true;

        // ── 8. Insights ───────────────────────────────────────────────────────
        List<String> insights = new List<String>();
        for (String nm : teamOrder) {
            Decimal targetMins = weeklyTgt.get(nm) * 4 * 60;
            Decimal loggedMins = personTotalMins.get(nm);
            Integer pct        = personUtil.get(nm);
            if (pct < 80) {
                Decimal gap = ((targetMins - loggedMins) / 60).setScale(0, RoundingMode.HALF_UP);
                insights.add(nm + ' at ' + pct + '% — ' + gap + 'h below target');
            } else if (pct > 110) {
                Decimal over = ((loggedMins - targetMins) / 60).setScale(0, RoundingMode.HALF_UP);
                insights.add(nm + ' at ' + pct + '% — ' + over + 'h above target (check for sustained overwork)');
            }
        }
        if (insights.isEmpty()) {
            insights.add('All 4 team members within expected utilization range (' + lowInt + '–' + highInt + '%)');
        }
        if (spread > 30) {
            insights.add('High utilization spread: ' + highName + ' at ' + highInt + '% vs ' + lowName + ' at ' + lowInt + '% — review workload balance');
        }

        // ── 10. Assemble CardData ─────────────────────────────────────────────
        CardData cd = new CardData();
        cd.title       = 'Individual Performance';
        cd.subtitle    = 'Last 4 Weeks';
        cd.question    = 'Did everyone meet their objectives?';
        cd.status      = status;
        cd.benchmarks  = bm('< 50% met targets', '50–80% met targets', '> 80% met targets');
        cd.kpis        = cardKpis;
        cd.modalKpis   = modalKpiList;
        cd.chartType   = 'bar';
        cd.chartLabels = ch1Labels;
        cd.datasets    = new List<ChartDataset>{ barDs, fteDs, alecDs };
        cd.insights    = insights;
        return cd;
    }

    // ── Row 2: Present ────────────────────────────────────────────────────────

    @AuraEnabled(cacheable=true)
    public static CardData getPresentManagement() {
        // Team capacity: 3 FTEs at 35h/wk + Head of Delivery at 20h/wk = 125h/wk
        Decimal contractorWeeklyHrs = (3 * 35) + 20; // 125h

        // Weekly demand from active projects (sum of on-pace hourly requirement)
        Decimal weeklyDemand   = 0;
        Integer activeProjects = 0;
        List<String>  projLabels = new List<String>();
        List<Decimal> projPace   = new List<Decimal>();
        for (Sprint__c s : [
            SELECT Name, On_Time_Weekly_Pace__c, Accountlu__r.Name
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
            ORDER BY On_Time_Weekly_Pace__c DESC NULLS LAST
            LIMIT  20
        ]) {
            activeProjects++;
            Decimal pace = s.On_Time_Weekly_Pace__c != null ? s.On_Time_Weekly_Pace__c : 0;
            weeklyDemand += pace;
            String lbl = s.Accountlu__r?.Name != null ? s.Accountlu__r.Name : s.Name;
            projLabels.add(lbl.length() > 16 ? lbl.substring(0, 16) + '…' : lbl);
            projPace.add(pace.setScale(1, RoundingMode.HALF_UP));
        }

        // Story hours estimate
        Decimal totalEstHrs = 0;
        AggregateResult hrsAr = [
            SELECT SUM(Hours_Estimate_to_Complete__c) hrs
            FROM   Case
            WHERE  Status NOT IN ('Completed','Closed','Cancelled')
        ];
        if (hrsAr.get('hrs') != null) totalEstHrs = (Decimal) hrsAr.get('hrs');

        // Blocked story count
        Integer blocked = [
            SELECT COUNT() FROM Case WHERE Status = 'Blocked'
        ];

        // Status: demand vs capacity — demand > capacity by 10%+ = critical
        Decimal demandRatio = contractorWeeklyHrs > 0 ? weeklyDemand / contractorWeeklyHrs : 0;
        String  status      = activeProjects == 0 ? 'neutral'
            : demandRatio > 1.1 ? 'critical'
            : demandRatio > 1.0 ? 'warning'
            : 'good';

        Decimal capH = contractorWeeklyHrs.setScale(1, RoundingMode.HALF_UP);
        Decimal demH = weeklyDemand.setScale(1, RoundingMode.HALF_UP);

        CardData cd = new CardData();
        cd.title      = 'Delivery Readiness';
        cd.subtitle   = 'This Week';
        cd.question   = 'Is delivery set up to execute this week?';
        cd.status     = status;
        cd.benchmarks = bm('Demand > capacity', 'Demand ≈ capacity', 'Capacity covers demand');
        cd.kpis = new List<KPI>{
            kpi('Demand / Internal Capacity', demH.setScale(0, RoundingMode.HALF_UP) + 'h / ' + capH.setScale(0, RoundingMode.HALF_UP) + 'h',
                                              demandRatio <= 1.0 ? 'up' : 'down', 'this week'),
            kpi('Est. Hours to Complete', totalEstHrs.setScale(0, RoundingMode.HALF_UP) + 'h', 'neutral', 'across active stories'),
            kpi('Blocked Stories', String.valueOf(blocked), blocked > 0 ? 'down' : 'neutral', 'need attention')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = projLabels;
        cd.datasets    = new List<ChartDataset>{ ds('Weekly Pace (h)', projPace, '#00b4d8') };
        cd.insights    = new List<String>{
            capH.setScale(0, RoundingMode.HALF_UP) + 'h team capacity vs ' + demH.setScale(0, RoundingMode.HALF_UP) + 'h committed demand across ' + activeProjects + ' active projects',
            totalEstHrs.setScale(0, RoundingMode.HALF_UP) + 'h total estimated to complete across all active stories',
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
            SELECT On_Time_Weekly_Pace__c, Project_End_Date__c
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
        ];

        Decimal contractorCap = 0;
        for (Contact c : [
            SELECT Available_Hours__c FROM Contact
            WHERE  Account.Name = 'CloudCrest Contractors'
              AND  Available_Hours__c != null AND Available_Hours__c > 0
        ]) {
            contractorCap += c.Available_Hours__c;
        }
        // TODO: FTE capacity is hardcoded (3 × 35h = 105h/wk); make configurable if headcount changes
        Decimal totalCap = 105 + contractorCap;

        List<String>  labels     = new List<String>();
        List<Decimal> demandData = new List<Decimal>();
        List<Decimal> capLine    = new List<Decimal>();
        Decimal wk4Demand = 0;
        Decimal wk8Demand = 0;

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
            if (i == 3) wk4Demand = d;  // 4th week in forecast
            if (i == 7) wk8Demand = d;  // 8th week in forecast
        }

        Integer wk4Util = totalCap > 0
            ? Integer.valueOf(((wk4Demand / totalCap) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;
        Integer wk8Util = totalCap > 0
            ? Integer.valueOf(((wk8Demand / totalCap) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;
        Decimal surplus = (totalCap - wk4Demand).setScale(1, RoundingMode.HALF_UP);

        // Sweet spot: 80–95% utilization; both extremes (<60% or >95%) are poor
        String status = totalCap == 0 ? 'neutral'
            : (wk4Util < 60 || wk4Util > 95) ? 'critical'
            : wk4Util >= 80                    ? 'good'
            : 'warning'; // 60–79%

        ChartDataset demDs = ds('Demand',   demandData, '#f59e0b');
        ChartDataset capDs = ds('Capacity', capLine,    '#0e7490');
        capDs.isDashed = true;

        CardData cd = new CardData();
        cd.title    = 'Utilization Forecast';
        cd.subtitle = 'Next 8 Weeks';
        cd.question   = 'Is our forecasted utilization balanced?';
        cd.status     = status;
        cd.benchmarks = bm('< 60% or > 95% util', '60–80% utilization', '80–95% utilization');
        cd.kpis = new List<KPI>{
            kpi('Wk 4 Forecast', wk4Util + '%', (wk4Util >= 80 && wk4Util <= 95) ? 'up' : 'down', 'projected utilization'),
            kpi('Wk 8 Forecast', wk8Util + '%', (wk8Util >= 80 && wk8Util <= 95) ? 'up' : 'down', 'projected utilization'),
            kpi('Net Balance',   (surplus >= 0 ? '+' : '') + surplus + 'h', surplus >= 0 ? 'up' : 'down', surplus >= 0 ? 'surplus at wk 4' : 'deficit at wk 4')
        };
        cd.chartType   = 'line';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ demDs, capDs };
        cd.insights    = new List<String>{
            'Week 4: ' + wk4Util + '% utilization (' + wk4Demand.setScale(0, RoundingMode.HALF_UP) + 'h demand vs ' + totalCap.setScale(0, RoundingMode.HALF_UP) + 'h capacity)',
            'Week 8: ' + wk8Util + '% utilization — demand trending ' + (wk8Demand <= wk4Demand ? 'down as projects close' : 'up as work ramps'),
            surplus >= 0 ? surplus + 'h/week surplus at week 4 — room to take on new work' : Math.abs(surplus) + 'h/week over capacity at week 4 — review resourcing'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getFutureCustomer() {
        Date today   = Date.today();
        Date w8Ahead = today.addDays(56); // 8 weeks
        Date ws      = today.toStartOfWeek();

        // Active projects ending in the next 8 weeks
        List<Sprint__c> ending = [
            SELECT Name, Project_End_Date__c, cc_Renewal_Notes__c, Accountlu__r.Name
            FROM   Sprint__c
            WHERE  Status__c          = 'In Progress'
              AND  Project_End_Date__c != null
              AND  Project_End_Date__c >= :today
              AND  Project_End_Date__c <= :w8Ahead
            ORDER BY Project_End_Date__c ASC
            LIMIT  20
        ];

        Integer endingCount = ending.size();
        Integer withPlan    = 0;
        for (Sprint__c s : ending) {
            // Proxy for transition plan: cc_Renewal_Notes__c has content
            if (s.cc_Renewal_Notes__c != null && s.cc_Renewal_Notes__c.trim() != '') withPlan++;
        }
        Integer unplanned = endingCount - withPlan;

        // Incoming pipeline: Not Started projects
        Integer incoming = [
            SELECT COUNT() FROM Sprint__c WHERE Status__c = 'Not Started'
        ];

        // Weekly demand shape for all active projects (8-week bar chart)
        List<Sprint__c> active = [
            SELECT On_Time_Weekly_Pace__c, Project_End_Date__c
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
        ];
        List<String>  labels     = new List<String>();
        List<Decimal> demandData = new List<Decimal>();
        for (Integer i = 0; i < 8; i++) {
            Date wk = ws.addDays(i * 7);
            labels.add(weekLabel(wk));
            Decimal d = 0;
            for (Sprint__c s : active) {
                if (s.Project_End_Date__c == null || wk <= s.Project_End_Date__c) {
                    d += s.On_Time_Weekly_Pace__c != null ? s.On_Time_Weekly_Pace__c : 0;
                }
            }
            demandData.add(d.setScale(1, RoundingMode.HALF_UP));
        }

        // Status: any ending project without a transition plan = critical
        String status = endingCount == 0 ? 'neutral'
            : (unplanned > 0 && unplanned == endingCount) ? 'critical'
            : unplanned > 0                               ? 'warning'
            : 'good';

        CardData cd = new CardData();
        cd.title    = 'Client Transitions';
        cd.subtitle = 'Next 8 Weeks';
        cd.question   = 'Are client transitions and forecasts accounted for?';
        cd.status     = status;
        cd.benchmarks = bm('Endings w/o notes', 'Some transitions noted', 'All transitions noted');
        cd.kpis = new List<KPI>{
            kpi('Endings in 8 wks',   String.valueOf(endingCount), endingCount > 0 ? 'down' : 'neutral', 'projects closing'),
            kpi('Transition Notes',   withPlan + '/' + endingCount, withPlan == endingCount ? 'up' : 'down', 'renewals documented'),
            kpi('Incoming Pipeline',  String.valueOf(incoming),     incoming > 0 ? 'up' : 'neutral', 'not-started projects')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Demand h/wk', demandData, '#f59e0b') };
        cd.insights    = new List<String>{
            endingCount + ' project' + (endingCount == 1 ? '' : 's') + ' ending in the next 8 weeks',
            unplanned > 0
                ? unplanned + ' ending project' + (unplanned == 1 ? '' : 's') + ' have no renewal or transition notes — act now'
                : 'All ending projects have transition notes on file',
            incoming + ' not-started project' + (incoming == 1 ? '' : 's') + ' in the pipeline'
        };
        return cd;
    }

    @AuraEnabled(cacheable=true)
    public static CardData getFutureEmployee() {
        Date ws         = Date.today().toStartOfWeek();
        Date twoWksAgo  = Date.today().addDays(-14);
        Date wk4Date    = ws.addDays(3 * 7); // 4th week from now

        // Contractor roster and available capacity
        Map<String, Decimal> contractorMap = new Map<String, Decimal>();
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
            contractorMap.put(c.Name, c.Available_Hours__c);
            labels.add(c.Name);
            available.add(c.Available_Hours__c);
            totalContractor += c.Available_Hours__c;
        }

        // Active contractors: logged time in the last 14 days
        Set<String> recentNames = new Set<String>();
        for (AggregateResult ar : [
            SELECT CreatedBy.Name nm
            FROM   Time__c
            WHERE  Logged_Date__c >= :twoWksAgo
            GROUP BY CreatedBy.Name
        ]) {
            recentNames.add((String) ar.get('nm'));
        }
        Integer activeNow = 0;
        for (String nm : contractorMap.keySet()) {
            if (recentNames.contains(nm)) activeNow++;
        }

        // Week-4 demand from active projects
        Decimal wk4Demand = 0;
        for (Sprint__c s : [
            SELECT On_Time_Weekly_Pace__c, Project_End_Date__c
            FROM   Sprint__c
            WHERE  Status__c = 'In Progress'
        ]) {
            if (s.Project_End_Date__c == null || wk4Date <= s.Project_End_Date__c) {
                wk4Demand += s.On_Time_Weekly_Pace__c != null ? s.On_Time_Weekly_Pace__c : 0;
            }
        }

        Integer wk4Util = totalContractor > 0
            ? Integer.valueOf(((wk4Demand / totalContractor) * 100).setScale(0, RoundingMode.HALF_UP))
            : 0;

        // Unaccounted slots: unfilled contractor capacity at week 4 expressed as headcount
        Decimal avgContractorHrs   = contractorMap.size() > 0 ? totalContractor / contractorMap.size() : 0;
        Decimal unaccountedHrs     = Math.max(0, totalContractor - wk4Demand);
        Integer unaccountedSlots   = (avgContractorHrs > 0 && contractorMap.size() > 0)
            ? Integer.valueOf((unaccountedHrs / avgContractorHrs).setScale(0, RoundingMode.HALF_UP))
            : 0;

        String status = contractorMap.size() == 0 ? 'neutral'
            : wk4Util < 60  ? 'critical'
            : wk4Util >= 80 ? 'good'
            : 'warning';

        CardData cd = new CardData();
        cd.title    = 'Assignment Forecast';
        cd.subtitle = 'Next 8 Weeks';
        cd.question   = 'Has everyone been assigned in the forecast?';
        cd.status     = status;
        cd.benchmarks = bm('Unaccounted contractors', 'Gaps within 2 wks', 'All assigned 4+ wks out');
        cd.kpis = new List<KPI>{
            kpi('Active Now',       activeNow + '/' + contractorMap.size(),  activeNow == contractorMap.size() ? 'up' : 'down', 'logged in last 14d'),
            kpi('Wk 4 Utilization', wk4Util + '%',                           wk4Util >= 80 ? 'up' : 'down', 'forecasted demand'),
            kpi('Unaccounted Slots', String.valueOf(unaccountedSlots),        unaccountedSlots > 0 ? 'down' : 'neutral', 'unfilled at wk 4')
        };
        cd.chartType   = 'bar';
        cd.chartLabels = labels;
        cd.datasets    = new List<ChartDataset>{ ds('Hrs / Week', available, '#0077b6') };
        cd.insights    = new List<String>{
            activeNow + ' of ' + contractorMap.size() + ' contractors actively engaged in the last 14 days',
            'Week 4 forecast: ' + wk4Util + '% utilization (' + wk4Demand.setScale(0, RoundingMode.HALF_UP) + 'h demand vs ' + totalContractor.setScale(0, RoundingMode.HALF_UP) + 'h capacity)',
            unaccountedSlots > 0
                ? unaccountedSlots + ' contractor slot' + (unaccountedSlots == 1 ? '' : 's') + ' unaccounted for at week 4 — assignment planning needed'
                : 'Forecasted demand accounts for all contractor capacity at week 4'
        };
        return cd;
    }

    // ── Drilldown: per-project week-over-week trend ───────────────────────────

    @AuraEnabled(cacheable=true)
    public static DrilldownData getProjectWeeklyHours(Id projectId) {
        Date ws    = Date.today().toStartOfWeek();
        Date w8Ago = ws.addDays(-7 * 7); // 8 weeks back (current week = wk 8)

        List<Sprint__c> projs = [
            SELECT Name, Weekly_Pace_Estimate__c, Contract_Type__c, Pace_Status__c, Accountlu__r.Name
            FROM   Sprint__c WHERE Id = :projectId LIMIT 1
        ];
        if (projs.isEmpty()) return null;
        Sprint__c proj     = projs[0];
        String    projName = proj.Accountlu__r?.Name != null ? proj.Accountlu__r.Name : proj.Name;
        Boolean   isBlock  = proj.Contract_Type__c == 'Block';
        Decimal   wklyHrs  = (!isBlock && proj.Weekly_Pace_Estimate__c != null) ? proj.Weekly_Pace_Estimate__c : 0;

        Map<Date, Decimal> byWeek = new Map<Date, Decimal>();
        for (AggregateResult ar : [
            SELECT Logged_Date__c dt, SUM(Minutes_Logged__c) m
            FROM   Time__c
            WHERE  Case__r.Projects__c = :projectId
              AND  Logged_Date__c >= :w8Ago
            GROUP BY Logged_Date__c
        ]) {
            Date    day = (Date)    ar.get('dt');
            Decimal m   = ar.get('m') != null ? (Decimal) ar.get('m') : 0;
            Date    wk  = day.toStartOfWeek();
            byWeek.put(wk, (byWeek.containsKey(wk) ? byWeek.get(wk) : 0) + m);
        }

        DrilldownData dd = new DrilldownData();
        dd.projectName = projName;
        dd.labels      = new List<String>();
        dd.delivered   = new List<Decimal>();
        dd.committed   = isBlock ? null : new List<Decimal>();

        for (Integer i = 7; i >= 0; i--) {
            Date    wk = ws.addDays(-i * 7);
            Decimal h  = byWeek.containsKey(wk) ? (byWeek.get(wk) / 60).setScale(1, RoundingMode.HALF_UP) : 0;
            dd.labels.add(weekLabel(wk));
            dd.delivered.add(h);
            if (!isBlock) dd.committed.add(wklyHrs);
        }

        // Summary KPIs for drilldown header
        Decimal sumDelivered = 0;
        for (Decimal h : dd.delivered) sumDelivered += h;
        dd.totalDelivered = sumDelivered.setScale(1, RoundingMode.HALF_UP);
        dd.paceStatus     = proj.Pace_Status__c;
        if (!isBlock && wklyHrs > 0) {
            Decimal committed8wk = wklyHrs * 8;
            dd.deliveryRate = Integer.valueOf(((sumDelivered / committed8wk) * 100).setScale(0, RoundingMode.HALF_UP));
        }
        return dd;
    }
}
