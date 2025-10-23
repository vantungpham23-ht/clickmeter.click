import { createClient } from '@supabase/supabase-js'

const supabaseUrl = 'https://tkzeotjknumllqvkgkzk.supabase.co'
const supabaseServiceKey = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InRremVvdGprbnVtbGxxdmtna3prIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2MTE0MjYwNywiZXhwIjoyMDc2NzE4NjA3fQ.zx6zizZQmfMVIePE22nw1T-WM1mBzVfC7VwSSB9rP9k'

const supabase = createClient(supabaseUrl, supabaseServiceKey)

async function checkAndCreateTestData() {
  try {
    // Kiểm tra user
    const { data: users, error: userError } = await supabase.auth.admin.listUsers()
    if (userError) {
      console.error('Error getting users:', userError)
      return
    }
    
    console.log('Users:', users.users.map(u => ({ id: u.id, email: u.email })))
    
    if (users.users.length === 0) {
      console.log('No users found')
      return
    }
    
    const userId = users.users[0].id
    
    // Kiểm tra sites
    const { data: sites, error: sitesError } = await supabase
      .from('sites')
      .select('*')
    
    if (sitesError) {
      console.error('Error getting sites:', sitesError)
      return
    }
    
    console.log('Sites:', sites)
    
    // Tạo site test nếu chưa có
    if (sites.length === 0) {
      const { data: newSite, error: insertError } = await supabase
        .from('sites')
        .insert({
          site_name: 'Test Site',
          cloudflare_zone_id: 'test-zone-id',
          filter_path: '/link1',
          user_id: userId
        })
        .select()
      
      if (insertError) {
        console.error('Error creating site:', insertError)
      } else {
        console.log('Created test site:', newSite)
      }
    }
    
  } catch (err) {
    console.error('Exception:', err)
  }
}

checkAndCreateTestData()
