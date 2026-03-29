public with sharing class TAMmapController {

    @AuraEnabled(cacheable=true)
    public static List<StateCount> getAccountCountsByState() {
        List<AggregateResult> results = [
            SELECT BillingState state, COUNT(Id) cnt
            FROM Account
            WHERE BillingState != null AND BillingState != ''
            GROUP BY BillingState
            ORDER BY COUNT(Id) DESC
        ];

        List<StateCount> counts = new List<StateCount>();
        for (AggregateResult ar : results) {
            StateCount sc = new StateCount();
            sc.state = (String) ar.get('state');
            sc.count  = (Integer) ar.get('cnt');
            counts.add(sc);
        }
        return counts;
    }

    public class StateCount {
        @AuraEnabled public String  state;
        @AuraEnabled public Integer count;
    }
}
