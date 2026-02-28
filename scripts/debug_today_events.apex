Date today    = Date.today();
DateTime dayStart = DateTime.newInstance(today,            Time.newInstance(0, 0, 0, 0));
DateTime dayEnd   = DateTime.newInstance(today.addDays(1), Time.newInstance(0, 0, 0, 0));

System.debug('Today: ' + today);
System.debug('dayStart: ' + dayStart);
System.debug('dayEnd: ' + dayEnd);
System.debug('Running as: ' + UserInfo.getUserId() + ' / ' + UserInfo.getName());

List<Event> events = [
    SELECT Id, Subject, StartDateTime, EndDateTime, OwnerId
    FROM Event
    WHERE OwnerId = :UserInfo.getUserId()
    AND StartDateTime >= :dayStart
    AND StartDateTime < :dayEnd
    ORDER BY StartDateTime ASC
];

System.debug('Events found: ' + events.size());
for (Event e : events) {
    System.debug('  Event: ' + e.Subject + ' | Start: ' + e.StartDateTime);
}

// Also check without OwnerId filter to see all today's events
List<Event> allToday = [
    SELECT Id, Subject, StartDateTime, OwnerId
    FROM Event
    WHERE StartDateTime >= :dayStart
    AND StartDateTime < :dayEnd
];
System.debug('All events today (any owner): ' + allToday.size());
for (Event e : allToday) {
    System.debug('  ' + e.Subject + ' | Owner: ' + e.OwnerId);
}
