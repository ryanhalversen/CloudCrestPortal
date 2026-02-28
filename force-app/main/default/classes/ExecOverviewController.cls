public with sharing class ExecOverviewController {

    // ── KPI Summary ───────────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static Map<String, Integer> getKpiSummary() {
        Map<String, Integer> kpi = new Map<String, Integer>{
            'total' => 0, 'completed' => 0, 'blocked' => 0,
            'inProgress' => 0, 'inReview' => 0, 'backlog' => 0,
            'inUAT' => 0, 'cancelled' => 0
        };
        for (AggregateResult ar : [
            SELECT Status, COUNT(Id) cnt
            FROM Case
            GROUP BY Status
        ]) {
            String s = (String) ar.get('Status');
            Integer c = (Integer) ar.get('cnt');
            kpi.put('total', kpi.get('total') + c);
            if (s == 'Completed')             kpi.put('completed',  c);
            else if (s == 'Blocked')          kpi.put('blocked',    c);
            else if (s == 'Work In Progress') kpi.put('inProgress', c);
            else if (s == 'In Review')        kpi.put('inReview',   c);
            else if (s == 'Backlog')          kpi.put('backlog',    c);
            else if (s == 'In UAT')           kpi.put('inUAT',      c);
            else if (s == 'Cancelled')        kpi.put('cancelled',  c);
        }
        return kpi;
    }

    // ── Stories by Department ─────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getStoriesByDepartment() {
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (AggregateResult ar : [
            SELECT Department__c dept, COUNT(Id) cnt
            FROM Case
            WHERE Department__c != null
            GROUP BY Department__c
            ORDER BY COUNT(Id) DESC
        ]) {
            result.add(new Map<String, Object>{
                'dept'  => ar.get('dept'),
                'count' => ar.get('cnt')
            });
        }
        return result;
    }

    // ── Stories by Priority ───────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getStoriesByPriority() {
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (AggregateResult ar : [
            SELECT Priority p, COUNT(Id) cnt
            FROM Case
            WHERE Priority != null
            GROUP BY Priority
            ORDER BY COUNT(Id) DESC
        ]) {
            result.add(new Map<String, Object>{
                'priority' => ar.get('p'),
                'count'    => ar.get('cnt')
            });
        }
        return result;
    }

    // ── Stories by Type ───────────────────────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getStoriesByType() {
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        for (AggregateResult ar : [
            SELECT Type, COUNT(Id) cnt
            FROM Case
            WHERE Type != null
            GROUP BY Type
            ORDER BY COUNT(Id) DESC
        ]) {
            result.add(new Map<String, Object>{
                'type'  => (String) ar.get('Type'),
                'count' => (Integer) ar.get('cnt')
            });
        }
        return result;
    }

    // ── Story Type Trend by Sprint Week ───────────────────────────
    @AuraEnabled(cacheable=true)
    public static List<Map<String, Object>> getTypeTrend() {
        List<Map<String, Object>> result = new List<Map<String, Object>>();
        Map<Decimal, Map<String, Integer>> weekTypeMap = new Map<Decimal, Map<String, Integer>>();
        for (Case c : [
            SELECT Sprint_Week__c, Type
            FROM Case
            WHERE Sprint_Week__c != null
            AND Type != null
        ]) {
            Decimal week = c.Sprint_Week__c;
            if (!weekTypeMap.containsKey(week)) weekTypeMap.put(week, new Map<String, Integer>());
            Map<String, Integer> typeMap = weekTypeMap.get(week);
            typeMap.put(c.Type, (typeMap.containsKey(c.Type) ? typeMap.get(c.Type) : 0) + 1);
        }
        List<Decimal> weeks = new List<Decimal>(weekTypeMap.keySet());
        weeks.sort();
        for (Decimal week : weeks) {
            for (String t : weekTypeMap.get(week).keySet()) {
                result.add(new Map<String, Object>{
                    'week'  => week,
                    'type'  => t,
                    'count' => weekTypeMap.get(week).get(t)
                });
            }
        }
        return result;
    }
}