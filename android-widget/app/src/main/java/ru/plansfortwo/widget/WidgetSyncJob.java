package ru.plansfortwo.widget;

import android.app.job.JobInfo;
import android.app.job.JobParameters;
import android.app.job.JobScheduler;
import android.app.job.JobService;
import android.content.ComponentName;
import android.content.Context;

public class WidgetSyncJob extends JobService {
    private static final int JOB_ID = 201114;
    static void schedule(Context c) {
        JobScheduler scheduler = (JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if(scheduler==null)return;
        if(scheduler.getPendingJob(JOB_ID)!=null)return;
        JobInfo info=new JobInfo.Builder(JOB_ID,new ComponentName(c,WidgetSyncJob.class))
            .setPeriodic(Api.DAY)
            .setRequiredNetworkType(JobInfo.NETWORK_TYPE_ANY)
            .setPersisted(true).build();
        scheduler.schedule(info);
    }
    static void cancel(Context c) {
        JobScheduler scheduler=(JobScheduler)c.getSystemService(Context.JOB_SCHEDULER_SERVICE);
        if(scheduler!=null)scheduler.cancel(JOB_ID);
    }
    @Override public boolean onStartJob(JobParameters params) {
        if(Api.prefs(this).getString("token","").isEmpty())return false;
        new Thread(()->{
            try { Api.fetch(getApplicationContext(),false); } catch(Exception ignored) { }
            try { CoupleWidget.redrawAll(getApplicationContext()); } finally { jobFinished(params,false); }
        },"widget-daily-sync").start();
        return true;
    }
    @Override public boolean onStopJob(JobParameters params) {return true;}
}
